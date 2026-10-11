/**
 * Prompt / 参数调试脚本（不在生产链路中）。
 *
 *   npm run try-llm -- "如果我当时接受了那份去深圳的工作" low
 *   npm run try-llm -- "如果我当时接受了那份去深圳的工作" medium 800
 *
 * 打印原始输出长度、usage 与完整内容，用于迭代 prompt 和推理强度。
 */

import OpenAI from 'openai';
import { config } from '../src/config.js';
import { RESPONSE_FORMAT_NAME, STORY_JSON_SCHEMA } from '../src/llm/schema.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../src/llm/prompt.js';

const input = process.argv[2] ?? '如果我当时辞职去大理开咖啡店';
const effort = (process.argv[3] ?? config.stepfun.reasoningEffort) as 'low' | 'medium' | 'high';
const maxTokens = Number(process.argv[4] ?? config.stepfun.maxTokens);

const client = new OpenAI({
  apiKey: config.stepfun.apiKey,
  baseURL: config.stepfun.baseUrl,
  timeout: config.stepfun.timeoutMs,
});

const started = Date.now();
const res = await client.chat.completions.create({
  model: config.stepfun.model,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input) },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: RESPONSE_FORMAT_NAME,
      strict: true,
      schema: STORY_JSON_SCHEMA as unknown as Record<string, unknown>,
    },
  },
  max_tokens: maxTokens,
  temperature: 0.9,
  reasoning_effort: effort,
} as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & { reasoning_effort: string });

const choice = res.choices?.[0];
const content = choice?.message?.content ?? '';
console.log(`输入：${input}`);
console.log(`effort=${effort} max_tokens=${maxTokens} 耗时=${Date.now() - started}ms`);
console.log(`finish_reason=${choice?.finish_reason} usage=${JSON.stringify(res.usage)}`);
console.log(`输出长度=${content.length} 字符`);
console.log('----- 原始输出 -----');
console.log(content);
