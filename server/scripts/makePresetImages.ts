/**
 * 生成三张预置插画（MVP 用，黑白高对比线描，适合 58mm 热敏打印）。
 * 图片生成模型接入后，可由 assets/presets 替换为按 session 出图。
 *
 *   npm run make-preset-images
 *
 * 画风约束来自 PRD §7.3：黑白、高对比、画面信息集中、避免大面积灰阶和细碎背景。
 * 热敏纸只有 1-bit，灰阶靠排线（hatch）制造，不能靠渐变色。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(here, '..');
const ROOT = path.resolve(SERVER_DIR, '..');
const SIZE = 384;

class Canvas {
  png: PNG;

  constructor(size = SIZE) {
    this.png = new PNG({ width: size, height: size });
    this.png.data.fill(255);
  }

  private dot(x: number, y: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.png.width || yi >= this.png.height) return;
    const i = (this.png.width * yi + xi) << 2;
    this.png.data[i] = 0;
    this.png.data[i + 1] = 0;
    this.png.data[i + 2] = 0;
    this.png.data[i + 3] = 255;
  }

  line(x0: number, y0: number, x1: number, y1: number, thickness = 4): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    const half = Math.floor(thickness / 2);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + (dx * i) / steps;
      const y = y0 + (dy * i) / steps;
      for (let ox = -half; ox <= half; ox++) {
        for (let oy = -half; oy <= half; oy++) this.dot(x + ox, y + oy);
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, thickness = 4): void {
    this.line(x, y, x + w, y, thickness);
    this.line(x + w, y, x + w, y + h, thickness);
    this.line(x + w, y + h, x, y + h, thickness);
    this.line(x, y + h, x, y, thickness);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    for (let iy = y; iy < y + h; iy++) for (let ix = x; ix < x + w; ix++) this.dot(ix, iy);
  }

  circle(cx: number, cy: number, r: number, thickness = 4): void {
    const steps = Math.max(64, Math.round(r * 8));
    const half = Math.floor(thickness / 2);
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      for (let ox = -half; ox <= half; ox++) {
        for (let oy = -half; oy <= half; oy++) this.dot(x + ox, y + oy);
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number): void {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) this.dot(cx + x, cy + y);
      }
    }
  }

  star(cx: number, cy: number, outer: number, inner: number, thickness = 4): void {
    const pts: [number, number][] = [];
    for (let i = 0; i < 10; i++) {
      const a = (-90 + i * 36) * (Math.PI / 180);
      const r = i % 2 === 0 ? outer : inner;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    pts.forEach(([x, y], i) => {
      const [nx, ny] = pts[(i + 1) % pts.length]!;
      this.line(x, y, nx, ny, thickness);
    });
  }

  /**
   * 排线阴影。热敏纸只有黑白两色，渐变的灰会抖成噪点，
   * 用等距 45° 平行线是唯一可靠的"灰阶"手段。
   */
  hatch(x0: number, y0: number, x1: number, y1: number, spacing = 16, thickness = 2): void {
    const h = y1 - y0;
    if (x1 <= x0 || h <= 0) return;
    // 从顶边出发的 45° 线，覆盖右上
    for (let sx = x0; sx <= x1; sx += spacing) {
      this.line(sx, y0, sx + h, y1, thickness);
    }
    // 从左边出发的 45° 线，补足左下
    for (let sy = y0 + spacing; sy < y1; sy += spacing) {
      this.line(x0, sy, x0 + (y1 - sy), y1, thickness);
    }
  }

  save(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(this.png));
  }
}

/** 第一幕 · 滤镜：窗、晨光、窗台上的植物 */
function drawAct1(): Canvas {
  const c = new Canvas();
  // 窗框：细线 + 十字棂，左上留白让画面透气
  c.rect(64, 44, 256, 196, 5);
  c.line(192, 44, 192, 240, 4);
  c.line(64, 142, 320, 142, 4);
  // 晨光：右上格一个实心太阳 + 三道斜射的光
  c.fillCircle(268, 100, 26);
  c.line(240, 128, 214, 154, 3);
  c.line(266, 136, 248, 166, 3);
  c.line(292, 128, 282, 160, 3);
  // 左下格排线，表示屋内阴影，和右上的亮形成对比
  c.hatch(72, 150, 184, 232, 15, 2);
  // 窗台与植物
  c.line(48, 240, 336, 240, 6);
  c.rect(96, 282, 52, 46, 4);
  c.line(122, 282, 122, 240, 3);
  c.line(122, 252, 100, 228, 3);
  c.line(122, 252, 146, 228, 3);
  c.line(100, 228, 92, 214, 3);
  c.line(146, 228, 154, 214, 3);
  c.hatch(104, 300, 140, 322, 12, 2);
  return c;
}

/** 第二幕 · 代价：时钟、雨、一杯冷掉的咖啡 */
function drawAct2(): Canvas {
  const c = new Canvas();
  // 时钟：指针指向 4 点多，暗示"很晚了"
  c.circle(150, 128, 72, 5);
  c.line(150, 44, 150, 58, 4);
  c.line(150, 198, 150, 212, 4);
  c.line(72, 128, 86, 128, 4);
  c.line(214, 128, 228, 128, 4);
  c.line(150, 128, 150, 78, 4);
  c.line(150, 128, 192, 156, 4);
  c.fillCircle(150, 128, 8);
  // 表盘下半排线，给钟一点重量
  c.hatch(96, 150, 204, 190, 14, 2);
  // 雨：左下几道斜线
  for (let i = 0; i < 5; i++) {
    const x = 44 + i * 34;
    c.line(x, 236, x + 16, 296, 3);
  }
  // 咖啡杯 + 手柄 + 两缕热气
  c.rect(236, 250, 84, 62, 4);
  c.line(320, 264, 344, 264, 4);
  c.line(344, 264, 344, 292, 4);
  c.line(344, 292, 320, 292, 4);
  c.line(258, 238, 262, 218, 3);
  c.line(272, 238, 276, 218, 3);
  c.hatch(244, 286, 312, 306, 13, 2);
  return c;
}

/** 第三幕 · 意外：星星、笔记本电脑 */
function drawAct3(): Canvas {
  const c = new Canvas();
  // 星星偏左上，留出右下给笔记本，形成对角构图
  c.star(104, 108, 62, 26, 5);
  c.line(48, 196, 66, 196, 3);
  c.line(160, 40, 178, 40, 3);
  c.line(186, 190, 204, 190, 3);
  c.line(150, 62, 168, 62, 3);
  // 笔记本电脑：屏幕 + 两行内容 + 底座
  c.rect(150, 208, 176, 112, 5);
  c.line(150, 226, 326, 226, 3);
  c.line(192, 262, 284, 262, 3);
  c.line(192, 282, 284, 282, 3);
  c.line(134, 336, 342, 336, 7);
  c.line(150, 348, 326, 348, 4);
  // 底座下排线当作桌面投影
  c.hatch(150, 352, 326, 372, 15, 2);
  return c;
}

const targets: [string, Canvas][] = [
  ['act-1.png', drawAct1()],
  ['act-2.png', drawAct2()],
  ['act-3.png', drawAct3()],
];

for (const [name, canvas] of targets) {
  const presetPath = path.join(ROOT, 'assets', 'presets', name);
  const webPath = path.join(ROOT, 'web', 'img', name);
  canvas.save(presetPath);
  canvas.save(webPath);
  console.log(`已生成 ${path.relative(ROOT, presetPath)} 和 ${path.relative(ROOT, webPath)}`);
}
console.log('完成：三张 384x384 黑白线描预置插画（细线 + 排线灰阶）');
