/**
 * 把已生成的插画热敏化，用于快速看效果（不用等 90 秒重新生成）。
 *
 *   npx tsx scripts/thermalizeExisting.ts [sessionId]
 *
 * 不带 sessionId 时取 out/images 里最近的一个。
 */

import fs from 'node:fs';
import path from 'node:path';
import { thermalizePng } from '../src/device/escpos.js';
import { config } from '../src/config.js';

const dir = path.resolve(process.env.PRINT_IMAGE_DIR ?? 'out/images');

function latestSession(): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => /-\d+\.png$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) return null;
  return files[0].f.replace(/-\d+\.png$/, '');
}

const sid = process.argv[2] ?? latestSession();
if (!sid) {
  console.error('out/images 里没有已生成的插画');
  process.exit(1);
}

console.log(`session ${sid}，热敏化到 ${config.print.imageSizePx} 点宽`);
const outDir = '/tmp/thermal';
fs.mkdirSync(outDir, { recursive: true });

for (const n of [1, 2, 3]) {
  const file = path.join(dir, `${sid}-${n}.png`);
  if (!fs.existsSync(file)) {
    console.log(`  第 ${n} 幕：缺原图，跳过`);
    continue;
  }
  const raw = fs.readFileSync(file);
  const printed = thermalizePng(raw, config.print.imageSizePx);
  // 回填到 out/images，让 /sessions/:id/images/:n 直接能返回热敏版
  fs.writeFileSync(path.join(dir, `${sid}-${n}.print.png`), printed);
  // 同时放一份到 /tmp 方便快速看
  fs.writeFileSync(path.join(outDir, `${n}.png`), printed);
  console.log(`  第 ${n} 幕：原图 ${(raw.length / 1024) | 0}KB → 热敏化 ${(printed.length / 1024) | 0}KB，已回填`);
}
console.log(`\n已写入 ${dir}/${sid}-*.print.png，副本在 ${outDir}/`);
