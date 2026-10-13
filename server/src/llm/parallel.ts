import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import { config } from '../config.js';
import { checkInput, checkStoryText } from './safety.js';
import { getClient, NO_KEY_MESSAGE } from './generate.js';

export const parallelRouter = Router();

// 预赛 Demo 与后端同源部署；不让其他网站借用浏览器中的本地服务与密钥。
parallelRouter.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        res.status(403).json({ error: '请从本地 Demo 页面发起请求。' });
        return;
      }
    } catch {
      res.status(403).json({ error: '无效的请求来源。' });
      return;
    }
  }
  next();
});

const OptionalContext = z.string().trim().max(80).refine((value) => value === '' || value.length >= 4);
const Lens = z.string().trim().max(30).refine((value) => value === '' || value.length >= 2);
const Text = z.string().trim().min(8).max(130);
const Path = z.object({ label: z.string().trim().min(2).max(32), gain: Text, cost: Text, envy: Text }).strict();
const Parallel = z.object({ title: z.string().trim().min(2).max(36), assumption: Text, present: Path, alternate: Path, synthesis: Text }).strict();
const AlternateOnly = z.object({ title: z.string().trim().min(2).max(36), alternate: Path }).strict();
const Revision = z.object({ newReading: Text, reason: Text, capsuleLine: z.string().trim().min(4).max(80) }).strict();
const CreateInput = z.object({ text: z.string().trim().min(1).max(100), presentContext: OptionalContext.optional().default(''), lens: Lens.optional().default('') }).strict();
const ReviseInput = z.object({ text: z.string().trim().min(1).max(100), lens: Lens.optional().default(''), original: Parallel, challenge: z.string().trim().min(5).max(100) }).strict();
const UNKNOWN_PRESENT = {
  label: '现在这条路 · 未提供信息',
  gain: '你没有提供现实经历；这里不会替你编造目前的所得。',
  cost: '你没有提供现实经历；生活中的代价也不由模型决定。',
  envy: '你是否羡慕另一边，只有你自己能够回答。',
};

const pathSchema = { type: 'object', additionalProperties: false, required: ['label', 'gain', 'cost', 'envy'], properties: {
  label: { type: 'string' }, gain: { type: 'string' }, cost: { type: 'string' }, envy: { type: 'string' },
}};
const parallelSchema = { type: 'object', additionalProperties: false, required: ['title', 'assumption', 'present', 'alternate', 'synthesis'], properties: {
  title: { type: 'string' }, assumption: { type: 'string' }, present: pathSchema, alternate: pathSchema, synthesis: { type: 'string' },
}};
const alternateSchema = { type: 'object', additionalProperties: false, required: ['title', 'alternate'], properties: {
  title: { type: 'string' }, alternate: pathSchema,
}};
const revisionSchema = { type: 'object', additionalProperties: false, required: ['newReading', 'reason', 'capsuleLine'], properties: {
  newReading: { type: 'string' }, reason: { type: 'string' }, capsuleLine: { type: 'string' },
}};

const system = `你是「没走的路」的互动叙事作者，不是占卜师或心理治疗师。只输出 JSON，不输出 Markdown。全部简体中文，具体、克制、轻微幽默而不残酷。两条路都有所得和日常代价，不能把疾病、死亡、贫困或真实人物的过错当作惩罚或笑点。绝对不要臆断或补全用户现实经历。若只知道未走的选择，仅写那条没走的路；若用户自愿补充了当前线索，现实线也只能写基于这句线索的虚构情境，不宣称是其真实经历。不要断言未来。每个字段 20-70 字，意象要生动、简短；envy 表示这条路可能会怀念什么；绝不能为未知的现实编造细节。不得包含私密真实人物推断或违法色情内容。`;

async function structured<T>(req: Request, schema: object, name: string, prompt: string, validator: z.ZodType<T>): Promise<T> {
  const client = getClient(req.header('x-stepfun-api-key') || undefined);
  if (!client) throw new Error(config.mockLlm ? '当前是 MOCK_LLM 模式；请选择预置案例体验，或关闭该模式并配置真实模型。' : NO_KEY_MESSAGE);
  const model = req.header('x-stepfun-model') || config.stepfun.model;
  const params = {
    model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    max_tokens: config.stepfun.maxTokens, temperature: 0.8, reasoning_effort: config.stepfun.reasoningEffort,
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort: string };
  const response = await client.chat.completions.create(params);
  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error('模型返回为空，请重试');
  const parsed = validator.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error('模型输出格式不符合要求，请重试');
  if (!checkStoryText(JSON.stringify(parsed.data))) throw new Error('内容安全检查未通过，请换个表述');
  return parsed.data;
}

function verifyText(text: string, res: Response): boolean {
  // 仅拦截明显的联系方式/身份证号；姓名等无法可靠自动识别，仍需 UI 告知。
  if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)/.test(text)) {
    res.status(422).json({ error: '请删除邮箱、手机号或身份证号后再继续。' });
    return false;
  }
  const verdict = checkInput(text);
  if (verdict.safe) return true;
  res.status(422).json({ error: verdict.reason === 'crisis'
    ? '这段话值得被认真对待，而不是做成游戏。请联系信任的人；如果有即刻危险，请联系当地急救服务。'
    : verdict.advice || '这段输入不适合生成故事，请换个表述。', care: verdict.reason === 'crisis' });
  return false;
}

function fail(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : '生成失败';
  // 第三方错误可能回显用户输入或服务商响应；不把原始错误写进日志或返回浏览器。
  console.error('[parallel]', err instanceof Error ? err.name : 'UnknownError');
  const known = /API Key|MOCK_LLM|模型返回为空|模型输出格式|内容安全检查/.test(msg);
  res.status(/API Key|MOCK_LLM/.test(msg) ? 503 : 502).json({ error: known ? msg : '模型服务暂不可用，请稍后重试或选择预置案例。' });
}

parallelRouter.post('/create', async (req: Request, res: Response) => {
  const input = CreateInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: '请输入 10–100 字；可选择性补充现实线索与关注点。' }); return; }
  if (!verifyText(input.data.text, res)) return;
  if (input.data.presentContext && !verifyText(input.data.presentContext.padEnd(10, '。'), res)) return;
  if (input.data.lens && !verifyText(input.data.lens.padEnd(10, '。'), res)) return;
  const start = Date.now();
  try {
    const lens = input.data.lens || '未指定；不要推断用户最在意什么';
    let story: z.infer<typeof Parallel>;
    if (input.data.presentContext) {
      const generated = await structured(req, parallelSchema, 'parallel_paths',
        `未走的路：${input.data.text}\n用户自愿提供的当前线索：${input.data.presentContext}\n想关注的角度：${lens}。请为两条路分别写出可能的所得、日常代价、互相羡慕之处。当前线索之外的生活细节只能作为虚构情境，不得声称知道用户现实。assumption 应明确这是基于用户一句线索的虚构推演。synthesis 不给哪条判优。`, Parallel);
      story = { ...generated, assumption: '现在这条路仅依据你自愿提供的一句线索想象；未提供的细节不是事实。', present: { ...generated.present, label: '现在这条路 · 情境推演' } };
    } else {
      const generated = await structured(req, alternateSchema, 'alternate_path_only',
        `未走的路：${input.data.text}\n想关注的角度：${lens}。用户没有提供任何现实经历，不要猜测现在选了什么，也不要写现在的生活。只写那条未走之路：可能的所得、代价，以及那条路的人可能会怀念的“尚有选择的空间”（不是猜测真实现状）。`, AlternateOnly);
      story = { ...generated, assumption: '你没有提供现在这条路的信息；这一边保持未知，不让 AI 补写你的现实。', present: UNKNOWN_PRESENT, synthesis: '另一条路有风景也有代价；现在这条路的故事，只有你自己能补上。' };
    }
    res.json({ source: 'ai', story, lens: input.data.lens, hasPresentContext: Boolean(input.data.presentContext), durationMs: Date.now() - start, model: req.header('x-stepfun-model') || config.stepfun.model });
  } catch (err) { fail(res, err); }
});

parallelRouter.post('/revise', async (req: Request, res: Response) => {
  const input = ReviseInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: '改判内容无效；请先生成双路故事，再写 5–100 字异议。' }); return; }
  if (!verifyText(input.data.text, res) || !verifyText(input.data.challenge.padEnd(10, '。'), res)) return;
  if (input.data.lens && !verifyText(input.data.lens.padEnd(10, '。'), res)) return;
  const start = Date.now();
  try {
    const revision = await structured(req, revisionSchema, 'parallel_revision',
      `原输入：${input.data.text}\n关注角度：${input.data.lens || '未指定'}\n原双路故事：${JSON.stringify(input.data.original)}\n用户的异议：${input.data.challenge}\n${input.data.original.present.label.includes('未提供信息') ? '现实经历未知：绝不能在改判中新增关于现在的生活事实。' : '现实线只是基于一句自愿线索的虚构情境，不要称为事实。'}\n只修订原 synthesis 的判断，不改写两条路的事实，不贬低任何一条路。newReading 是响应异议之后的新理解；reason 用一两句可观察的理由解释变化（不是隐藏思维链）；capsuleLine 是可放进纸胶囊的温柔、有趣、简短的一句话。`, Revision);
    res.json({ source: 'ai', revision: { oldReading: input.data.original.synthesis, ...revision }, durationMs: Date.now() - start, model: req.header('x-stepfun-model') || config.stepfun.model });
  } catch (err) { fail(res, err); }
});
