import OpenAI from 'openai';
import { config, CANONICAL_DISCLAIMER } from '../config.js';
import {
  RESPONSE_FORMAT_NAME,
  STORY_JSON_SCHEMA,
  StorySchema,
  normalizeStory,
  type Story,
} from './schema.js';
import { SYSTEM_PROMPT, buildRetryPrompt, buildUserPrompt } from './prompt.js';
import { CARE_RESPONSE, checkInput, checkStoryText } from './safety.js';
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

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (config.mockLlm) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: config.stepfun.apiKey,
      baseURL: config.stepfun.baseUrl,
      timeout: config.stepfun.timeoutMs,
      maxRetries: 1,
    });
  }
  return client;
}

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
 */
export async function generateStory(input: string): Promise<GenerateResult> {
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

  const llm = getClient();
  if (!llm) {
    return demoResult(input, startedAt, '未配置 STEPFUN_API_KEY 或 MOCK_LLM=1', 0);
  }

  const problems: string[] = [];
  /** 思考过程也占额度，偶发会超过上限；被截断时自动加额重试 */
  let currentMaxTokens = config.stepfun.maxTokens;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const messages =
        attempt === 1
          ? [
              { role: 'system' as const, content: SYSTEM_PROMPT },
              { role: 'user' as const, content: buildUserPrompt(input) },
            ]
          : [
              { role: 'system' as const, content: SYSTEM_PROMPT },
              { role: 'user' as const, content: buildRetryPrompt(input, problems) },
            ];

      // reasoning_effort 是 StepFun 的扩展参数（OpenAI SDK 类型未覆盖），需断言
      const params = {
        model: config.stepfun.model,
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
        `[llm] 第 ${attempt} 次尝试：${Date.now() - startedAt}ms，` +
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
      const allText = [story.title, ...story.scenes.map((s) => s.caption), story.ending].join(' ');
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
