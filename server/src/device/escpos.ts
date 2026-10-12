/**
 * 热敏打印工具链：PNG → 1-bit 位图 → ESC/POS 指令。
 *
 * 58mm 打印机 = 384 点/行。服务端完成所有排版与位图转换，
 * 硬件只负责把字节流写进打印机（PRD 第 11 节：降低联调复杂度）。
 */

import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { ASSETS_DIR, config } from '../config.js';

export interface Bitmap {
  width: number;
  height: number;
  bytesPerLine: number;
  /** 1bpp，行内 MSB 优先，bit=1 表示打印黑点 */
  data: Buffer;
}

const PRINT_WIDTH = config.print.widthPx;

/* ------------------------------------------------------------------ */
/* PNG → 1-bit 位图                                                    */
/* ------------------------------------------------------------------ */

/** 灰度 + 双线性缩放 + Floyd–Steinberg 抖动 + 位打包 */
export function pngToBitmap(pngBuffer: Buffer, targetWidth = PRINT_WIDTH): Bitmap {
  const png = PNG.sync.read(pngBuffer);
  const w0 = png.width;
  const h0 = png.height;
  const rgba = png.data;

  const scale = targetWidth / w0;
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(h0 * scale));

  const gray = new Float32Array(width * height);
  const lum = (i: number): number => {
    if (rgba[i + 3] !== undefined && rgba[i + 3] < 128) return 255;
    return (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  };

  for (let y = 0; y < height; y++) {
    const sy = Math.min(h0 - 1, Math.max(0, (y + 0.5) / scale - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(h0 - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = Math.min(w0 - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(w0 - 1, x0 + 1);
      const fx = sx - x0;
      const a = lum((y0 * w0 + x0) * 4) * (1 - fx) + lum((y0 * w0 + x1) * 4) * fx;
      const b = lum((y1 * w0 + x0) * 4) * (1 - fx) + lum((y1 * w0 + x1) * 4) * fx;
      gray[y * width + x] = a * (1 - fy) + b * fy;
    }
  }

  // Floyd–Steinberg 抖动（热敏纸只有黑白两色，直接阈值会有大片灰块）
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const old = gray[idx];
      const next = old < 128 ? 0 : 255;
      gray[idx] = next;
      const err = old - next;
      const spread = (dx: number, dy: number, f: number): void => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny >= height) return;
        gray[ny * width + nx] += (err * f) / 16;
      };
      spread(1, 0, 7);
      spread(-1, 1, 3);
      spread(0, 1, 5);
      spread(1, 1, 1);
    }
  }

  const bytesPerLine = Math.ceil(width / 8);
  const data = Buffer.alloc(bytesPerLine * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < 128) {
        data[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { width, height, bytesPerLine, data };
}

/* ------------------------------------------------------------------ */
/* 位图 → ESC/POS                                                      */
/* ------------------------------------------------------------------ */

/** GS v 0：光栅位图打印 */
export function bitmapToRasterCmd(bmp: Bitmap): Buffer {
  const header = Buffer.from([
    0x1d, 0x76, 0x30, 0x00,
    bmp.bytesPerLine & 0xff, (bmp.bytesPerLine >> 8) & 0xff,
    bmp.height & 0xff, (bmp.height >> 8) & 0xff,
  ]);
  return Buffer.concat([header, bmp.data]);
}

/** 文本行（GBK 编码，中文热敏打印机通用）+ 换行 */
export function textToEscPos(text: string): Buffer {
  return Buffer.concat([iconv.encode(text, 'gbk'), Buffer.from('\n', 'ascii')]);
}

export function feedLines(n = 1): Buffer {
  return Buffer.concat([Buffer.from([0x1b, 0x64]), Buffer.from([n])]);
}

export const ESC = {
  init: (): Buffer => Buffer.from([0x1b, 0x40]),
  align: (n: 0 | 1 | 2): Buffer => Buffer.from([0x1b, 0x61, n]),
  bold: (on: boolean): Buffer => Buffer.from([0x1b, 0x45, on ? 1 : 0]),
};

/** 虚线分隔线（位图，保证 384 点对齐） */
export function dashedLineBitmap(width = PRINT_WIDTH, dash = 8, gap = 6, thickness = 2): Bitmap {
  const bytesPerLine = Math.ceil(width / 8);
  const data = Buffer.alloc(bytesPerLine * thickness);
  for (let x = 0; x < width; x++) {
    if (x % (dash + gap) < dash) {
      for (let y = 0; y < thickness; y++) {
        data[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { width, height: thickness, bytesPerLine, data };
}

/* ------------------------------------------------------------------ */
/* 二维码 → 位图                                                       */
/* ------------------------------------------------------------------ */

export function qrToBitmap(text: string, maxWidth = PRINT_WIDTH): Bitmap {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const quiet = 4;
  const total = size + quiet * 2;
  const scale = Math.max(2, Math.floor(maxWidth / total));
  const width = total * scale;
  const height = total * scale;
  const bytesPerLine = Math.ceil(width / 8);
  const data = Buffer.alloc(bytesPerLine * height);

  const isDark = (r: number, c: number): boolean => {
    const mods = qr.modules as unknown as {
      get?: (r: number, c: number) => boolean;
      data: Uint8Array | number[][];
    };
    if (typeof mods.get === 'function') return mods.get(r, c);
    const d = mods.data;
    const v = Array.isArray(d) ? d[r]?.[c] : d[r * size + c];
    return Boolean(v);
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isDark(r, c)) continue;
      const x0 = (c + quiet) * scale;
      const y0 = (r + quiet) * scale;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const x = x0 + dx;
          const y = y0 + dy;
          data[y * bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
  }
  return { width, height, bytesPerLine, data };
}

/* ------------------------------------------------------------------ */
/* 小票排版                                                            */
/* ------------------------------------------------------------------ */

/** 避头尾：不能出现在行首的收尾标点 */
const NO_LINE_START = '，。、；：？！」』）】〉》”’…‰·,.;:?!)]}>';
/** 避头尾：不能留在行尾的开引号 / 开括号 */
const NO_LINE_END = '「『（【〈《“‘([{<';
/** 意群边界：在这些字符之后换行，读起来比逐字硬折自然得多 */
const BREAK_AFTER = '，。、；：？！」』）】〉》”’…';

/** 逐字折行（遵守避头尾），仅用于单个意群就超宽的情况 */
function wrapByChar(text: string, maxChars: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let line: string[] = [];

  const flush = (): void => {
    if (line.length > 0) lines.push(line.join(''));
    line = [];
  };

  for (const ch of chars) {
    if (line.length >= maxChars) {
      const last = line[line.length - 1]!;
      if (NO_LINE_END.includes(last)) {
        line.pop();
        flush();
        line = [last, ch];
        continue;
      }
      flush();
      line = [ch];
      continue;
    }
    if (line.length === 0 && NO_LINE_START.includes(ch) && lines.length > 0) {
      const prev = lines.pop()!;
      const prevChars = Array.from(prev);
      const borrowed = prevChars.pop();
      if (borrowed !== undefined && prevChars.length > 0) {
        lines.push(prevChars.join(''));
        line = [borrowed, ch];
        continue;
      }
      lines.push(prev);
    }
    line.push(ch);
  }
  flush();
  return lines;
}

/**
 * 折行：先按标点切意群，再把意群组装成行。
 *
 * 逐字硬折会把短语拆断——实测出现过「三种风 / 味；房东…」这样的断行，
 * 读起来是断的。改成在意群边界换行后同样一段变成：
 *   旺季时每天站十二小时，
 *   淡季用同一袋豆子解释三种风味；
 *   房东第三次涨租那天，窗外的云依然很好看。
 * 只有单个意群本身就超过行宽时，才退回逐字折行（仍遵守避头尾）。
 */
export function wrapText(text: string, maxChars = 24): string[] {
  const segments: string[] = [];
  let seg: string[] = [];
  for (const ch of Array.from(text)) {
    seg.push(ch);
    if (BREAK_AFTER.includes(ch)) {
      segments.push(seg.join(''));
      seg = [];
    }
  }
  if (seg.length > 0) segments.push(seg.join(''));

  const lines: string[] = [];
  let line = '';
  for (const s of segments) {
    if (line === '') {
      line = s;
    } else if (Array.from(line).length + Array.from(s).length <= maxChars) {
      line += s;
    } else {
      lines.push(line);
      line = s;
    }
  }
  if (line !== '') lines.push(line);

  const out: string[] = [];
  for (const l of lines) {
    if (Array.from(l).length <= maxChars) out.push(l);
    else out.push(...wrapByChar(l, maxChars));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 位图辅助                                                            */
/* ------------------------------------------------------------------ */

function setBit(bmp: Bitmap, x: number, y: number): void {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return;
  bmp.data[y * bmp.bytesPerLine + (x >> 3)] |= 0x80 >> (x & 7);
}

function getBit(bmp: Bitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bmp.width || y >= bmp.height) return false;
  return (bmp.data[y * bmp.bytesPerLine + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
}

function blankBitmap(width: number, height: number): Bitmap {
  const bytesPerLine = Math.ceil(width / 8);
  return { width, height, bytesPerLine, data: Buffer.alloc(bytesPerLine * height) };
}

/**
 * 给插画加细边框。一张裸方图直接贴在纸上很散，加框后成为独立的"图版"，
 * 与文字块形成清晰的图/文分区。
 */
export function framedImage(bmp: Bitmap, pad = 12, thickness = 3): Bitmap {
  const width = bmp.width + pad * 2;
  const height = bmp.height + pad * 2;
  const out = blankBitmap(width, height);
  for (let t = 0; t < thickness; t++) {
    for (let x = t; x < width - t; x++) {
      setBit(out, x, t);
      setBit(out, x, height - 1 - t);
    }
    for (let y = t; y < height - t; y++) {
      setBit(out, t, y);
      setBit(out, width - 1 - t, y);
    }
  }
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      if (getBit(bmp, x, y)) setBit(out, x + pad, y + pad);
    }
  }
  return out;
}

/** 主分隔线：双细线，比单根粗线更有票据质感 */
export function doubleRule(width = PRINT_WIDTH, gap = 8, thickness = 2): Bitmap {
  const out = blankBitmap(width, thickness * 2 + gap);
  for (let x = 0; x < width; x++) {
    for (let t = 0; t < thickness; t++) {
      setBit(out, x, t);
      setBit(out, x, out.height - 1 - t);
    }
  }
  return out;
}

/** 预置插画（MVP 用，见 assets/presets/；图片生成接入后替换为模型出图） */
export function presetImageBitmap(actIndex: number, targetWidth = config.print.imageSizePx): Bitmap | null {
  const file = path.join(ASSETS_DIR, 'presets', `act-${actIndex}.png`);
  if (!fs.existsSync(file)) return null;
  try {
    return pngToBitmap(fs.readFileSync(file), targetWidth);
  } catch {
    return null;
  }
}

export interface ReceiptOptions {
  title: string;
  /** 与模型输出的 scene 结构一致（image_prompt 预留：图片生成接入后排入小票） */
  scenes: { caption: string; image_prompt: string }[];
  ending: string;
  disclaimer: string;
  shareUrl: string;
  /** 有则用生成图（已转 1-bit），null 的幕回退到预置插画 */
  bitmaps?: (Bitmap | null)[];
}

/** 生成整张小票的 ESC/POS 字节流 */
export function buildReceiptBuffer(opts: ReceiptOptions): Buffer {
  const parts: Buffer[] = [];
  const push = (b: Buffer): void => {
    parts.push(b);
  };
  const imageSize = config.print.imageSizePx;

  push(ESC.init());

  /* 标题区：居中加粗 + 双线，作为版面顶端 */
  push(ESC.align(1));
  push(ESC.bold(true));
  push(textToEscPos(opts.title));
  push(ESC.bold(false));
  push(feedLines(1));
  push(bitmapToRasterCmd(doubleRule(PRINT_WIDTH)));
  push(feedLines(2));

  /* 三幕：标签 → 正文 → 图版。插画缩到 imageSize 并加框，让它退成"图版"
     而不是占满纸宽的主角，文字重新成为小票主体。 */
  push(ESC.align(0));
  const labels = ['第一幕 · 滤镜', '第二幕 · 代价', '第三幕 · 意外'];
  opts.scenes.forEach((scene, i) => {
    push(ESC.bold(true));
    push(textToEscPos(labels[i] ?? `第 ${i + 1} 幕`));
    push(ESC.bold(false));
    for (const line of wrapText(scene.caption, 24)) {
      push(textToEscPos(line));
    }
    push(feedLines(1));
    const bmp = presetImageBitmap(i + 1, imageSize);
    if (bmp) {
      push(ESC.align(1));
      push(bitmapToRasterCmd(framedImage(bmp)));
      push(ESC.align(0));
      push(feedLines(1));
    }
    // 幕与幕之间用细虚线；最后一幕之后由主双线收尾
    if (i < opts.scenes.length - 1) {
      push(bitmapToRasterCmd(dashedLineBitmap(PRINT_WIDTH, 4, 6, 1)));
      push(feedLines(1));
    }
  });

  /* 结尾区：双线 → 居中加粗结尾 → 免责声明 → 二维码 */
  push(bitmapToRasterCmd(doubleRule(PRINT_WIDTH)));
  push(feedLines(1));
  push(ESC.align(1));
  push(ESC.bold(true));
  for (const line of wrapText(opts.ending, 24)) push(textToEscPos(line));
  push(ESC.bold(false));
  push(feedLines(2));
  for (const line of wrapText(opts.disclaimer, 26)) push(textToEscPos(line));
  push(feedLines(1));
  push(textToEscPos('扫码查看这条没走的路'));
  push(bitmapToRasterCmd(qrToBitmap(opts.shareUrl)));
  push(feedLines(6));

  return Buffer.concat(parts);
}

/** 胶囊内芯：文字版三幕，不打印大幅插画与二维码，缩短纸带。
 * 仍需机械样机验证纸长、卷径、切刀与出仓；不是标准可吞服胶囊。
 */
export function buildCapsuleInsertBuffer(opts: ReceiptOptions & { sessionId: string }): Buffer {
  const parts: Buffer[] = [ESC.init(), ESC.align(1), ESC.bold(true), textToEscPos('后悔毒药 · 展示道具'), ESC.bold(false)];
  for (const line of wrapText(opts.title, 24)) parts.push(textToEscPos(line));
  parts.push(textToEscPos(`编号 ${opts.sessionId.slice(0, 8)}`), feedLines(1), ESC.align(0));
  const labels = ['滤镜', '代价', '意外'];
  opts.scenes.forEach((scene, i) => {
    parts.push(ESC.bold(true), textToEscPos(`${i + 1} ${labels[i] ?? '片段'}`), ESC.bold(false));
    for (const line of wrapText(scene.caption, 24)) parts.push(textToEscPos(line));
  });
  parts.push(feedLines(1), ESC.align(1), ESC.bold(true));
  for (const line of wrapText(opts.ending, 24)) parts.push(textToEscPos(line));
  parts.push(ESC.bold(false), textToEscPos('虚构想象 · 非人生预测'), textToEscPos('展示道具 · 请勿吞食'), feedLines(2));
  return Buffer.concat(parts);
}

/** 调试用：位图转 ASCII art（模拟设备/测试输出），stepX/stepY 为采样步长 */
export function bitmapToAscii(bmp: Bitmap, stepX = 1, stepY = 1): string {
  const rows: string[] = [];
  for (let y = 0; y < bmp.height; y += stepY) {
    let row = '';
    for (let x = 0; x < bmp.width; x += stepX) {
      const bit = (bmp.data[y * bmp.bytesPerLine + (x >> 3)] >> (7 - (x & 7))) & 1;
      row += bit ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}

/** 调试用：从 ESC/POS 字节流里抽出所有位图并转 ASCII art */
export function asciiArtFromEscPos(buffer: Buffer, stepX = 1, stepY = 1): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < buffer.length - 8) {
    if (buffer[i] === 0x1d && buffer[i + 1] === 0x76 && buffer[i + 2] === 0x30) {
      const bytesPerLine = buffer[i + 4] | (buffer[i + 5] << 8);
      const height = buffer[i + 6] | (buffer[i + 7] << 8);
      const data = buffer.subarray(i + 8, i + 8 + bytesPerLine * height);
      if (data.length === bytesPerLine * height) {
        out.push(bitmapToAscii({ width: bytesPerLine * 8, height, bytesPerLine, data }, stepX, stepY));
        i += 8 + bytesPerLine * height;
        continue;
      }
    }
    i++;
  }
  return out;
}
