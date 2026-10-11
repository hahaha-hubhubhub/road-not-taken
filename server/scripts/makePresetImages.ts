/**
 * 生成三张预置插画（MVP 用，384x384 黑白高对比线描）。
 * 图片生成模型接入后，可由 assets/presets 替换为按 session 出图。
 *
 *   npm run make-preset-images
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

  line(x0: number, y0: number, x1: number, y1: number, thickness = 6): void {
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

  rect(x: number, y: number, w: number, h: number, thickness = 6): void {
    this.line(x, y, x + w, y, thickness);
    this.line(x + w, y, x + w, y + h, thickness);
    this.line(x + w, y + h, x, y + h, thickness);
    this.line(x, y + h, x, y, thickness);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    for (let iy = y; iy < y + h; iy++) for (let ix = x; ix < x + w; ix++) this.dot(ix, iy);
  }

  circle(cx: number, cy: number, r: number, thickness = 6): void {
    const steps = Math.max(48, Math.round(r * 6));
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const half = Math.floor(thickness / 2);
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

  star(cx: number, cy: number, outer: number, inner: number, thickness = 6): void {
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

  save(file: string): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, PNG.sync.write(this.png));
  }
}

/** 第一幕 · 滤镜：窗、晨光、植物 */
function drawAct1(): Canvas {
  const c = new Canvas();
  c.rect(48, 40, 288, 240, 10);
  c.line(192, 40, 192, 280, 8);
  c.line(48, 160, 336, 160, 8);
  c.fillCircle(288, 96, 34);
  c.line(80, 280, 150, 344, 5);
  c.line(160, 280, 230, 344, 5);
  c.line(240, 280, 310, 344, 5);
  c.rect(58, 306, 46, 40, 5);
  c.line(81, 306, 81, 268, 5);
  c.line(81, 282, 62, 260, 4);
  c.line(81, 282, 100, 260, 4);
  return c;
}

/** 第二幕 · 代价：时钟、雨、冷掉的咖啡 */
function drawAct2(): Canvas {
  const c = new Canvas();
  c.circle(192, 140, 84, 10);
  c.line(192, 60, 192, 74, 7);
  c.line(192, 206, 192, 220, 7);
  c.line(112, 140, 126, 140, 7);
  c.line(258, 140, 272, 140, 7);
  c.line(192, 140, 192, 88, 7);
  c.line(192, 140, 240, 168, 7);
  c.fillCircle(192, 140, 9);
  for (let i = 0; i < 7; i++) {
    const x = 40 + i * 52;
    c.line(x, 252, x + 20, 322, 5);
  }
  c.rect(150, 288, 88, 56, 6);
  c.line(238, 302, 262, 302, 6);
  c.line(262, 302, 262, 326, 6);
  c.line(262, 326, 238, 326, 6);
  c.line(172, 276, 176, 258, 4);
  c.line(176, 276, 180, 258, 4);
  c.line(214, 276, 218, 258, 4);
  c.line(218, 276, 222, 258, 4);
  return c;
}

/** 第三幕 · 意外：星星、笔记本电脑 */
function drawAct3(): Canvas {
  const c = new Canvas();
  c.star(112, 118, 78, 33, 7);
  c.line(40, 214, 60, 214, 5);
  c.line(184, 40, 204, 40, 5);
  c.line(230, 214, 250, 214, 5);
  c.rect(150, 210, 180, 116, 7);
  c.line(136, 336, 344, 336, 10);
  c.line(150, 350, 330, 350, 6);
  c.line(192, 268, 288, 268, 5);
  c.line(192, 290, 288, 290, 5);
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
console.log('完成：三张 384x384 黑白线描预置插画');
