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
const AlternateOnly = z.object({ title: z.string().trim().min(2).max(36), alternate: Path, synthesis: Text }).strict();
const ChallengeType = z.enum(['flip', 'shake', 'press', 'free']);
const Revision = z.object({ newReading: Text, reason: Text, capsuleLine: z.string().trim().min(4).max(80) }).strict();
const CreateInput = z.object({ text: z.string().trim().min(1).max(100), presentContext: OptionalContext.optional().default(''), lens: Lens.optional().default('') }).strict();
const ReviseInput = z.object({ text: z.string().trim().min(1).max(100), lens: Lens.optional().default(''), original: Parallel, challenge: z.string().trim().min(5).max(100), challengeType: ChallengeType.optional().default('free') }).strict();
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
const alternateSchema = { type: 'object', additionalProperties: false, required: ['title', 'alternate', 'synthesis'], properties: {
  title: { type: 'string' }, alternate: pathSchema, synthesis: { type: 'string' },
}};
const revisionSchema = { type: 'object', additionalProperties: false, required: ['newReading', 'reason', 'capsuleLine'], properties: {
  newReading: { type: 'string' }, reason: { type: 'string' }, capsuleLine: { type: 'string' },
}};

const system = `你是《没走的路》里的毒舌药剂师。
玩家递来一句「如果当时」。
你不卖鸡汤。你开账单。

## 柜台规矩
- 先认账。那条路确实诱人。
- 再立规矩。好处后面跟代价。
- 故意丑化那条路。
- 这是喜剧化虚构。不是预测。
- 枪口朝路。不要朝玩家。
- 只损流程、账单、机器和规矩。
- 不说「你选对了」。
- 不安慰。也不教育。

## 说话方式
- 像柜台后的小老板。
- 话短。理硬。不绕。
- 单句尽量不超过 25 字。
- 每句话要有主语和动作。
- 数字要能查。物件要能看见。
- 网感靠节奏。不要硬塞热梗。
- 禁止品牌播音腔。
- 禁止心理报告腔。
- 禁止 AI 金句。
- 禁止空话：压力、消耗、成长、意义。

## 三格对应字段
- gain：广告片。先把好处认清。
- cost：营业后台。把账单摊开。
- envy：本人证词。让那边的我认账。

每个字段 20 到 70 字。
先具体。再好笑。
一格只立一个规矩。

## 动作对应补印
- flip：翻出隐藏条款。
- shake：摇出具体账单。
- press：让那边的我吐槽。

## 可以损什么
考勤、审批、会议、团建、KPI。
平台抽成、算法、租房、装修。
物业、签证、亲戚问话、AI 客服。
机器坏了。系统崩了。快递丢了。
事情可以很惨。人不能被羞辱。

## 只有这四条不碰
1. 出现自杀、自伤或正在发生的暴力。
   立刻停止搞笑。改用关怀回应。
2. 不编排可指认的真实个人。
3. 不拿身份和身体特征当笑点。
4. 不写违法教程和色情内容。

## 隐私规矩
没有现实线索，就不猜现实生活。
有线索，也只当虚构情境。
不要把推测写成事实。`;

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
    ? '这段先别拿来玩。请联系信任的人；如果有马上伤害自己的风险，直接联系当地急救服务。'
    : verdict.advice || '这段输入不适合生成故事，请换个表述。', care: verdict.reason === 'crisis' });
  return false;
}

function fail(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : '生成失败';
  // 第三方错误可能回显用户输入或服务商响应；不把原始错误写进日志或返回浏览器。
  console.error('[parallel]', err instanceof Error ? err.name : 'UnknownError');
  const known = /API Key|MOCK_LLM|模型返回为空|模型输出格式|内容安全检查/.test(msg);
  res.status(/API Key|MOCK_LLM/.test(msg) ? 503 : 502).json({ error: known ? msg : '模型服务暂不可用，请稍后重试或玩现成案例。' });
}

parallelRouter.post('/create', async (req: Request, res: Response) => {
  const input = CreateInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: '请输入 10–100 字；现实线索和关注点都可以不填。' }); return; }
  if (!verifyText(input.data.text, res)) return;
  if (input.data.presentContext && !verifyText(input.data.presentContext.padEnd(10, '。'), res)) return;
  if (input.data.lens && !verifyText(input.data.lens.padEnd(10, '。'), res)) return;
  const start = Date.now();
  try {
    const lens = input.data.lens || '未指定；不要推断用户最在意什么';
    let story: z.infer<typeof Parallel>;
    if (input.data.presentContext) {
      const generated = await structured(req, parallelSchema, 'parallel_paths',
        `没走的路：${input.data.text}
现实线索：${input.data.presentContext}
关注角度：${lens}

按三格开账。
gain 先认好处。
cost 打开营业后台。
envy 让那边的我认账。
每格 20 到 70 字。
必须有具体物件和数字。
title 8 到 16 字。
synthesis 10 到 30 字。
它只负责收尾。不要说教。

现实线索只当虚构情境。
没写的细节，不准当事实。`, Parallel);
      story = { ...generated, assumption: '现在这条路仅依据你自愿提供的一句线索想象；未提供的细节不是事实。', present: { ...generated.present, label: '现在这条路 · 情境推演' } };
    } else {
      const generated = await structured(req, alternateSchema, 'alternate_path_only',
        `没走的路：${input.data.text}
关注角度：${lens}

玩家没给现实经历。
不准猜他现在过得怎样。
只给没走的路开账。

gain 先认好处。
cost 打开营业后台。
envy 让那边的我认账。
每格 20 到 70 字。
必须有具体物件和数字。
title 8 到 16 字。
synthesis 8 到 40 字。
短句收尾。不要说教。`, AlternateOnly);
      story = { ...generated, assumption: '你没有提供现在这条路的信息；这一边保持未知，不让 AI 补写你的现实。', present: UNKNOWN_PRESENT, synthesis: generated.synthesis };
    }
    res.json({ source: 'ai', story, lens: input.data.lens, hasPresentContext: Boolean(input.data.presentContext), durationMs: Date.now() - start, model: req.header('x-stepfun-model') || config.stepfun.model });
  } catch (err) { fail(res, err); }
});

parallelRouter.post('/revise', async (req: Request, res: Response) => {
  const input = ReviseInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: '这个动作的小字无效；先让机器打印出票，再写 5–100 字。' }); return; }
  if (!verifyText(input.data.text, res) || !verifyText(input.data.challenge.padEnd(10, '。'), res)) return;
  if (input.data.lens && !verifyText(input.data.lens.padEnd(10, '。'), res)) return;
  const start = Date.now();
  try {
    const evidence = {
      flip: `玩家在机器上把票翻了个面，想看看这条路背面没写进广告的小字：${input.data.original.alternate.gain}`,
      shake: `玩家摇了摇机器，把这条路没写进广告的账单摇了出来：${input.data.original.alternate.cost}`,
      press: `玩家按住不放，让这条路里的那个虚构角色自己出来吐槽：${input.data.original.alternate.envy}`,
      free: '玩家自己提出的一条无害的日常麻烦',
    }[input.data.challengeType];
    const revision = await structured(req, revisionSchema, 'parallel_revision',
      `没走的路：${input.data.text}
关注角度：${input.data.lens || '未指定'}
原票：${JSON.stringify(input.data.original)}
动作：${input.data.challengeType}
动作证据：${evidence}
玩家补充：${input.data.challenge}
${input.data.original.present.label.includes('未提供信息') ? '现实经历未知。不要补写现实。' : '现实线只是虚构情境。不要当事实。'}

newReading 是补印的小字。
一到两句。20 到 70 字。
翻面，写隐藏条款。
摇一摇，写具体账单。
按住，写那边的我吐槽。
不要重复原票。
要有物件、数字和次数。
reason 只说这次翻出什么。
capsuleLine 12 到 40 字。
短。损。不要说教。`, Revision);
    res.json({ source: 'ai', revision: { oldReading: input.data.original.synthesis, ...revision }, challengeType: input.data.challengeType, durationMs: Date.now() - start, model: req.header('x-stepfun-model') || config.stepfun.model });
  } catch (err) { fail(res, err); }
});
