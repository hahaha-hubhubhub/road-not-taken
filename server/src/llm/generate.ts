import OpenAI from 'openai';
import { config, CANONICAL_DISCLAIMER } from '../config.js';
import {
  RESPONSE_FORMAT_NAME,
  STORY_JSON_SCHEMA,
  StorySchema,
  normalizeStory,
  type Story,
} from './schema.js';
import { SYSTEM_PROMPT, buildRetryPrompt, buildUserPrompt, createNarrativeDirection } from './prompt.js';
import { CARE_RESPONSE, checkInput, checkStoryText } from './safety.js';
import { checkStoryQuality } from './quality.js';
import { pickDemoCase } from './demoCases.js';

export type GenerateKind = 'story' | 'care' | 'demo';

export interface GenerateResult {
  /** story=模型生成；care=心理危机安抚；demo=降级到预生成案例 */
  kind: GenerateKind;
  story: Story;
  /** 是否发生了降级（演示保障） */
  degraded: boolean;
  durationMs: number;
  attempts: number;
  /** 降级原因（模型失败信息） */
  note?: string;
}

/** 输入不合规（太短/含禁止内容），直接返回给前端，不调用模型 */
export class InputRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputRejectedError';
  }
}

/**
 * 取得 LLM 客户端。
 * 优先级：请求头带的 Key / Base URL（页面「设置」里填的）> 服务端 .env。
 * 两者都没有时返回 null，由调用方决定是报错还是走演示模式。
 */
const clients = new Map<string, OpenAI>();

export function getClient(apiKey?: string, baseUrl?: string): OpenAI | null {
  if (config.mockLlm) return null; // 演示开关始终优先，避免页面/测试携带 Key 时误调用模型
  const key = (apiKey ?? config.stepfun.apiKey ?? '').trim();
  if (!key) return null;
  const base = (baseUrl ?? config.stepfun.baseUrl ?? '').trim().replace(/\/+$/, '') || 'https://api.stepfun.com/v1';
  const cacheKey = `${base}::${key}`;
  const hit = clients.get(cacheKey);
  if (hit) return hit;
  const created = new OpenAI({
    apiKey: key,
    baseURL: base,
    timeout: config.stepfun.timeoutMs,
    maxRetries: 1,
  });
  clients.set(cacheKey, created);
  return created;
}

export const NO_KEY_MESSAGE =
  '未配置 API Key：请点右上角「设置」填写 StepFun API Key（只保存在本机浏览器），或在服务端 .env 里配置 STEPFUN_API_KEY';

function demoResult(input: string, startedAt: number, note: string, attempts: number): GenerateResult {
  const preset = pickDemoCase(input);
  return {
    kind: 'demo',
    degraded: true,
    durationMs: Date.now() - startedAt,
    attempts,
    note,
    story: {
      title: preset.title,
      scenes: preset.scenes.map((s) => ({ ...s })),
      ending: preset.ending,
      disclaimer: CANONICAL_DISCLAIMER,
    },
  };
}

/**
 * 生成一条"去滤镜"的平行人生。
 * 顺序：输入安全 → LLM（JSON Schema 严格模式）→ zod 业务校验 → 重试 → 降级。
 * @param apiKey 调用方（页面设置）传入的 Key，优先于服务端 .env
 */
export async function generateStory(input: string, apiKey?: string, model?: string, baseUrl?: string): Promise<GenerateResult> {
  const startedAt = Date.now();

  const verdict = checkInput(input);
  if (!verdict.safe) {
    if (verdict.reason === 'crisis') {
      return {
        kind: 'care',
        degraded: false,
        durationMs: Date.now() - startedAt,
        attempts: 0,
        story: { ...CARE_RESPONSE, disclaimer: CANONICAL_DISCLAIMER },
      };
    }
    throw new InputRejectedError(verdict.advice ?? '输入不合规，请换一种说法');
  }

  const llm = getClient(apiKey, baseUrl);
  if (!llm) {
    if (config.mockLlm) return demoResult(input, startedAt, 'MOCK_LLM=1（演示模式）', 0);
    throw new Error(NO_KEY_MESSAGE);
  }

  const problems: string[] = [];
  const direction = createNarrativeDirection();
  /** 思考过程也占额度，偶发会超过上限；被截断时自动加额重试 */
  let currentMaxTokens = config.stepfun.maxTokens;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const messages =
        attempt === 1
          ? [
              { role: 'system' as const, content: SYSTEM_PROMPT },
              { role: 'user' as const, content: buildUserPrompt(input, direction) },
            ]
          : [
              { role: 'system' as const, content: SYSTEM_PROMPT },
              { role: 'user' as const, content: buildRetryPrompt(input, problems, direction) },
            ];

      // reasoning_effort 是 StepFun 的扩展参数（OpenAI SDK 类型未覆盖），需断言
      const useModel = (model ?? '').trim() || config.stepfun.model;
      const params = {
        model: useModel,
        messages,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: RESPONSE_FORMAT_NAME,
            strict: true,
            schema: STORY_JSON_SCHEMA as unknown as Record<string, unknown>,
          },
        },
        max_tokens: currentMaxTokens,
        temperature: 0.9,
        reasoning_effort: config.stepfun.reasoningEffort,
      } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort: string };

      const res = await llm.chat.completions.create(params);

      const reasoningTokens = res.usage?.completion_tokens_details?.reasoning_tokens;
      console.log(
        `[llm] ${useModel} 第 ${attempt} 次尝试：${Date.now() - startedAt}ms，` +
          `completion=${res.usage?.completion_tokens ?? '?'}（推理 ${reasoningTokens ?? '?'}）`,
      );

      const choice = res.choices?.[0];
      const content = choice?.message?.content;
      if (!content) throw new Error('模型返回了空内容');
      if (choice?.finish_reason === 'length') {
        currentMaxTokens = Math.min(Math.round(currentMaxTokens * 1.5), 12000);
        throw new Error(`输出被 max_tokens 截断（finish_reason=length），已提高到 ${currentMaxTokens}`);
      }

      const parsed: unknown = JSON.parse(content);
      const validated = StorySchema.safeParse(parsed);
      if (!validated.success) {
        problems.length = 0;
        for (const issue of validated.error.issues) {
          problems.push(`${issue.path.join('.') || '(root)'} ${issue.message}`);
        }
        continue;
      }

      const story = normalizeStory(validated.data);
      const qualityErrors = checkStoryQuality(input, story);
      if (qualityErrors.length) { problems.splice(0, problems.length, ...qualityErrors); continue; }
      const allText = [story.title, ...story.scenes.map((s) => `${s.caption} ${s.detail ?? ''}`), story.ending, story.letter ?? ''].join(' ');
      if (!checkStoryText(allText)) {
        problems.length = 0;
        problems.push('内容触碰安全边界');
        continue;
      }

      return {
        kind: 'story',
        degraded: false,
        durationMs: Date.now() - startedAt,
        attempts: attempt,
        story,
      };
    } catch (err) {
      // 断网 / 超时：重试没有意义，立即降级到预生成案例，保证演示不中断
      const name = err instanceof Error ? err.name : '';
      const message = err instanceof Error ? err.message : String(err);
      if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError' || name === 'APITimeoutError') {
        return demoResult(input, startedAt, `网络错误，已切换演示案例：${message}`, attempt);
      }
      problems.length = 0;
      problems.push(message);
    }
  }

  return demoResult(input, startedAt, `模型生成失败：${problems[problems.length - 1] ?? 'unknown'}`, config.maxAttempts);
}
