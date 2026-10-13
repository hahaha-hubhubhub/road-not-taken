/**
 * 直接调用 generateStory 并打印耗时与结果，用于定位"直连网关很快但服务端超时"。
 *
 *   npx tsx scripts/debugLlm.ts ["输入文本"]
 */

import { generateStory } from '../src/llm/generate.js';
import { config } from '../src/config.js';

const input = process.argv[2] ?? '如果我当时没有去那场招聘会';

console.log('配置：');
console.log('  baseUrl   :', config.stepfun.baseUrl);
console.log('  model     :', config.stepfun.model);
console.log('  maxTokens :', config.stepfun.maxTokens);
console.log('  timeoutMs :', config.stepfun.timeoutMs);
console.log('  effort    :', config.stepfun.reasoningEffort);
console.log('  maxAttempts:', config.maxAttempts);
console.log('');

const t0 = Date.now();
try {
  const r = await generateStory(input);
  const ms = Date.now() - t0;
  console.log(`完成，耗时 ${ms}ms`);
  console.log('  kind    :', r.kind);
  console.log('  degraded:', r.degraded);
  console.log('  note    :', r.note ?? '(无)');
  console.log('  attempts:', r.attempts);
  console.log('  title   :', r.story.title);
  r.story.scenes.forEach((s, i) => console.log(`  第${i + 1}幕: ${s.caption.slice(0, 40)}…`));
} catch (err) {
  console.log(`抛出异常，耗时 ${Date.now() - t0}ms：`, err instanceof Error ? err.message : err);
}
