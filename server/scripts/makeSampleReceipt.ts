/**
 * 用预生成演示案例直接产出一张小票字节流。
 * 不需要起服务端、不需要 API Key，改完排版或插画后用它验证最快。
 *
 *   npm run sample-receipt                        # 第一个案例
 *   npm run sample-receipt -- <caseId> <输出.bin>  # 指定案例与输出
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEMO_CASES } from '../src/llm/demoCases.js';
import { SHARE_BASE } from '../src/config.js';
import { buildReceiptBuffer } from '../src/device/escpos.js';

const caseId = process.argv[2];
const out = process.argv[3] ?? path.resolve('out', 'sample-receipt.bin');

const demo = caseId ? DEMO_CASES.find((c) => c.id === caseId) : DEMO_CASES[0];
if (!demo) {
  console.error(`找不到演示案例 ${caseId}；可用：${DEMO_CASES.map((c) => c.id).join(', ')}`);
  process.exit(1);
}

const buffer = buildReceiptBuffer({
  title: demo.title,
  scenes: demo.scenes.map((s) => ({ caption: s.caption, image_prompt: s.image_prompt })),
  ending: demo.ending,
  disclaimer: '这是模型生成的虚构故事，不是人生预测。',
  shareUrl: `${SHARE_BASE}/#/r/sample`,
});

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buffer);
console.log(`案例：${demo.id} — ${demo.label}`);
console.log(`输入：${demo.input}`);
console.log(`小票：${buffer.length} 字节 → ${out}`);
console.log(`预览：npm run receipt-html -- ${out}`);
