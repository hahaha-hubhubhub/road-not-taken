/**
 * 核对生成图是否真的进入小票字节流。
 *
 *   npx tsx scripts/checkImagesOnPaper.ts <sessionId>
 *
 * 对同一 session 分别构建「带生成图」「纯预置图」两版小票，比较字节数与
 * 位图段数，确认上图链路真的生效——字节数相同基本说明图没进去。
 */

import fs from 'node:fs';
import { generatedImageBitmaps } from '../src/llm/image.js';
import { buildReceiptBuffer, presetImageBitmap } from '../src/device/escpos.js';
import { config } from '../src/config.js';

const sid = process.argv[2];
if (!sid) {
  console.error('用法：npx tsx scripts/checkImagesOnPaper.ts <sessionId>');
  process.exit(1);
}

const API = process.env.PREVIEW_API ?? 'http://127.0.0.1:8787';
const r = await fetch(`${API}/api/sessions/${sid}`);
if (!r.ok) {
  console.error(`session ${sid} 不存在（HTTP ${r.status}）`);
  process.exit(1);
}
const s = (await r.json()) as {
  title?: string;
  ending?: string;
  disclaimer?: string;
  acts?: { caption: string; imagePrompt: string }[];
  imageReadyActs?: number[];
  imageStatus?: string;
};

if (!s.acts || s.acts.length < 3) {
  console.error('session 没有完整三幕，无法构建小票');
  process.exit(1);
}

const base = {
  title: s.title ?? '另一条路',
  scenes: s.acts.map((a) => ({ caption: a.caption, image_prompt: a.imagePrompt })),
  ending: s.ending ?? '',
  disclaimer: s.disclaimer ?? '',
  shareUrl: `${API}/#/r/${sid}`,
};

const size = config.print.imageSizePx;
const withGen = buildReceiptBuffer({
  ...base,
  bitmaps: generatedImageBitmaps(sid, s.imageReadyActs ?? []),
});
const withPreset = buildReceiptBuffer({
  ...base,
  bitmaps: [presetImageBitmap(1, size), presetImageBitmap(2, size), presetImageBitmap(3, size)],
});

/** 统计 GS v 0 光栅段数与总行数 */
function rasters(buf: Buffer): { segs: number; rows: number } {
  let segs = 0;
  let rows = 0;
  for (let i = 0; i + 8 <= buf.length; i++) {
    if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const x = buf[i + 4] + (buf[i + 5] << 8);
      const y = buf[i + 6] + (buf[i + 7] << 8);
      segs++;
      rows += y;
      i += 8 + x * y - 1;
    }
  }
  return { segs, rows };
}

const a = rasters(withGen);
const b = rasters(withPreset);
const same = withGen.equals(withPreset);

console.log(`session ${sid}  imageStatus=${s.imageStatus}  readyActs=${JSON.stringify(s.imageReadyActs ?? [])}`);
console.log('');
console.log(`  带生成图 : ${withGen.length} 字节  光栅 ${a.segs} 段 / ${a.rows} 行`);
console.log(`  纯预置图 : ${withPreset.length} 字节  光栅 ${b.segs} 段 / ${b.rows} 行`);
console.log('');
console.log('  注：ESC/POS 光栅字节数只由图片尺寸决定，与画面内容无关，');
console.log('      所以两版字节数相同是正常的，要比较的是内容。');
console.log('');
if (same) {
  console.log('  ❌ 两版内容完全一致 —— 生成图没有进入小票');
  process.exit(1);
}
console.log('  ✓ 两版内容不同，生成图已进入小票');

// 逐段比较光栅数据，确认三张图都换了
const segsOf = (buf: Buffer): { y: number; data: Buffer }[] => {
  const out: { y: number; data: Buffer }[] = [];
  for (let i = 0; i + 8 <= buf.length; i++) {
    if (buf[i] === 0x1d && buf[i + 1] === 0x76 && buf[i + 2] === 0x30) {
      const x = buf[i + 4] + (buf[i + 5] << 8);
      const y = buf[i + 6] + (buf[i + 7] << 8);
      out.push({ y, data: buf.subarray(i + 8, i + 8 + x * y) });
      i += 8 + x * y - 1;
    }
  }
  return out;
};
const sa = segsOf(withGen);
const sb = segsOf(withPreset);
const big = (list: { y: number }[]): number[] =>
  list.map((s, i) => (s.y > 100 ? i : -1)).filter((i) => i >= 0);
const ia = big(sa);
const ib = big(sb);
console.log('');
ia.forEach((idx, n) => {
  const diff = sa[idx].data.equals(sb[ib[n]].data) ? '相同' : '不同';
  console.log(`  第 ${n + 1} 张插画（${sa[idx].y} 行）：${diff}`);
});
