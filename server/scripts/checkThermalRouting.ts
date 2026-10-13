/**
 * 验证 imagePath 优先返回热敏化版，以及 thermalizePng 输出确实是纯黑白。
 *
 *   npx tsx scripts/checkThermalRouting.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { imagePath, rawImagePath } from '../src/llm/image.js';
import { thermalizePng } from '../src/device/escpos.js';

const probeSid = '__probe__';
const dir = path.dirname(rawImagePath(probeSid, 1) ?? path.resolve('out/images/__probe__-1.png'));
const sids = fs.existsSync(dir)
  ? [...new Set(fs.readdirSync(dir).filter((f) => /\.png$/.test(f)).map((f) => f.replace(/-\d+\.(print\.)?png$/, '')))]
      .filter((s) => s !== probeSid)
  : [];

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

console.log(`图片目录：${dir}`);
console.log(`已有 session：${sids.length} 个\n`);

/* 1. 造一个只有原图、没有热敏版的场景，确认回落 */
const probe = path.join(dir, `${probeSid}-1.png`);
if (sids.length > 0) {
  const first = sids[0];
  const raw = rawImagePath(first, 1);
  check(`${first} 原图存在`, raw !== null);
  if (raw) {
    const printed = imagePath(first, 1);
    check(`${first} imagePath 存在`, printed !== null);
    const isPrint = printed?.endsWith('.print.png') ?? false;
    const hasPrint = fs.existsSync(path.join(dir, `${first}-1.print.png`));
    check(
      `${first} 有热敏版时优先返回它`,
      !hasPrint || isPrint,
      `返回了 ${printed ? path.basename(printed) : 'null'}`,
    );
  }
}

/* 2. 热敏化输出必须是纯黑白（每点 R=G=B 且只有 0 或 255） */
const sample = sids.length > 0 ? rawImagePath(sids[0], 1) : null;
if (sample) {
  const out = thermalizePng(fs.readFileSync(sample), 256);
  const probeFile = probe;
  fs.writeFileSync(probeFile, out);
  const back = imagePath('__probe__', 1);
  check('无热敏版时回落原图', back === probeFile, `返回 ${back ? path.basename(back) : 'null'}`);
  fs.rmSync(probeFile, { force: true });

  // 用 pngjs 校验纯黑白
  const { PNG } = await import('pngjs');
  const p = PNG.sync.read(out);
  let nonBinary = 0;
  for (let i = 0; i < p.data.length; i += 4) {
    const v = p.data[i];
    if (v !== 0 && v !== 255) nonBinary++;
    if (p.data[i] !== p.data[i + 1] || p.data[i] !== p.data[i + 2]) nonBinary++;
  }
  check(`输出为纯黑白（${p.width}x${p.height}，非二值像素 ${nonBinary}）`, nonBinary === 0);
} else {
  console.log('  （没有已生成图可测，跳过内容校验）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
