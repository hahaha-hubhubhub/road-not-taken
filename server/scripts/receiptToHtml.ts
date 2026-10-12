/**
 * 把 ESC/POS 小票字节流渲染成 HTML 预览页。
 *
 * B 路下没有实体打印机也能核对排版：打印服务（默认 file 目标）会把字节流
 * 写到 out/，用本脚本还原成一张看得见的小票。
 *
 *   npm run receipt-html -- out/receipt-xxxxx.bin [输出.html]
 *
 * 不指定输出路径时写到 out/receipt-xxxxx.html，直接用浏览器打开。
 */

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import iconv from 'iconv-lite';

type Align = 0 | 1 | 2;

type Item =
  | { kind: 'text'; text: string; align: Align; bold: boolean }
  | { kind: 'image'; dataUrl: string; widthPx: number; heightPx: number; align: Align }
  | { kind: 'gap'; lines: number };

/** 1-bit 光栅数据 → PNG data URL（bit=1 为黑点） */
function rasterToDataUrl(data: Buffer, bytesPerLine: number, height: number): string {
  const png = new PNG({ width: bytesPerLine * 8, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bytesPerLine * 8; x++) {
      const byte = data[y * bytesPerLine + (x >> 3)];
      const black = (byte & (0x80 >> (x & 7))) !== 0;
      const idx = (png.width * y + x) << 2;
      png.data[idx] = png.data[idx + 1] = png.data[idx + 2] = black ? 0 : 255;
      png.data[idx + 3] = 255;
    }
  }
  return 'data:image/png;base64,' + PNG.sync.write(png).toString('base64');
}

function parse(buffer: Buffer): Item[] {
  const items: Item[] = [];
  let align: Align = 0;
  let bold = false;
  let textBytes: number[] = [];

  const flushText = (): void => {
    if (textBytes.length === 0) return;
    const text = iconv.decode(Buffer.from(textBytes), 'gbk');
    // 一条 ESC/POS 文本指令以 \n 结尾，解码后按行切开
    for (const line of text.split('\n')) {
      if (line.length > 0) items.push({ kind: 'text', text: line, align, bold });
    }
    textBytes = [];
  };

  for (let i = 0; i < buffer.length; ) {
    const c = buffer[i];

    if (c === 0x1b) {
      const n = buffer[i + 1];
      if (n === 0x40) {
        flushText();
        align = 0;
        bold = false;
        i += 2;
        continue;
      }
      if (n === 0x61) {
        flushText();
        align = ([0, 1, 2].includes(buffer[i + 2]) ? buffer[i + 2] : 0) as Align;
        i += 3;
        continue;
      }
      if (n === 0x45) {
        flushText();
        bold = buffer[i + 2] === 1;
        i += 3;
        continue;
      }
      if (n === 0x64) {
        flushText();
        items.push({ kind: 'gap', lines: buffer[i + 2] || 1 });
        i += 3;
        continue;
      }
      if (n === 0x4a) {
        flushText();
        items.push({ kind: 'gap', lines: 0 });
        i += 3;
        continue;
      }
      flushText();
      i += 2;
      continue;
    }

    if (c === 0x1d) {
      const n = buffer[i + 1];
      if (n === 0x76 && buffer[i + 2] === 0x30) {
        flushText();
        const bytesPerLine = buffer[i + 4] | (buffer[i + 5] << 8);
        const height = buffer[i + 6] | (buffer[i + 7] << 8);
        const data = buffer.subarray(i + 8, i + 8 + bytesPerLine * height);
        items.push({
          kind: 'image',
          dataUrl: rasterToDataUrl(data, bytesPerLine, height),
          widthPx: bytesPerLine * 8,
          heightPx: height,
          align,
        });
        i += 8 + bytesPerLine * height;
        continue;
      }
      if (n === 0x21) {
        flushText();
        i += 3;
        continue;
      }
      flushText();
      i += 2;
      continue;
    }

    if (c === 0x0a) {
      flushText();
      i += 1;
      continue;
    }

    textBytes.push(c);
    i += 1;
  }
  flushText();
  return items;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderHtml(items: Item[], source: string, byteLength: number): string {
  const SCALE = 1.6; // 1 点 → 1.6px，屏幕上接近真机宽度
  const body = items
    .map((it) => {
      if (it.kind === 'gap') {
        return it.lines > 0 ? `<div style="height:${it.lines * 32 * SCALE}px"></div>` : '';
      }
      if (it.kind === 'image') {
        // 1-2 点高的"位图"是虚线分隔线，直接按比例渲染即可
        const h = Math.max(1, it.heightPx * SCALE);
        const w = it.widthPx * SCALE;
        const justify = it.align === 1 ? 'center' : it.align === 2 ? 'flex-end' : 'flex-start';
        return `<div class="row" style="justify-content:${justify}"><img src="${it.dataUrl}" style="width:${w}px;height:${h}px;image-rendering:pixelated"></div>`;
      }
      const justify = it.align === 1 ? 'center' : it.align === 2 ? 'flex-end' : 'flex-start';
      const weight = it.bold ? '700' : '400';
      return `<div class="row" style="justify-content:${justify}"><span style="font-weight:${weight}">${escapeHtml(it.text)}</span></div>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>小票预览 — ${escapeHtml(path.basename(source))}</title>
<style>
  body { margin:0; padding:32px 16px; background:#e8e6e1; display:flex; flex-direction:column; align-items:center;
         font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",monospace; }
  .meta { color:#6b6660; font-size:12px; margin-bottom:16px; font-family:ui-monospace,monospace; }
  .receipt { background:#fff; color:#000; padding:28px 22px; width:${384 * SCALE}px;
             box-shadow:0 2px 14px rgba(0,0,0,.18); }
  .row { display:flex; line-height:1.55; font-size:${15 * SCALE / 1.6}px; white-space:pre; }
  .row img { display:block; }
</style>
</head>
<body>
<div class="meta">${escapeHtml(source)} · ${byteLength} 字节 · 384 点宽 ≈ 48mm</div>
<div class="receipt">
${body}
</div>
</body>
</html>`;
}

const file = process.argv[2];
if (!file) {
  console.error('用法：npm run receipt-html -- <receipt.bin> [输出.html]');
  process.exit(1);
}
const buffer = fs.readFileSync(file);
const items = parse(buffer);
const out = process.argv[3] ?? path.join(path.dirname(file), path.basename(file).replace(/\.bin$/, '') + '.html');
fs.writeFileSync(out, renderHtml(items, path.basename(file), buffer.length));
console.log(`已生成 ${out}`);
console.log(`  文本 ${items.filter((i) => i.kind === 'text').length} 行，图片 ${items.filter((i) => i.kind === 'image').length} 张`);
