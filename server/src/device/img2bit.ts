/**
 * 图片 → 热敏位图转换工具（图片接入前的调试/预览用）。
 *
 *   npm run img2bit -- assets/presets/act-1.png
 *   npm run img2bit -- assets/presets/act-1.png --out out/act1.bin --ascii
 */

import fs from 'node:fs';
import path from 'node:path';
import { asciiArtFromEscPos, bitmapToAscii, bitmapToRasterCmd, pngToBitmap } from './escpos.js';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('用法：npm run img2bit -- <png> [--out <bin>] [--ascii] [--w 384]');
  process.exit(1);
}
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const width = Number(flag('w', '384'));
const out = argv.includes('--out') ? flag('out', '') : '';
const showAscii = argv.includes('--ascii');

const png = fs.readFileSync(file);
const bmp = pngToBitmap(png, width);
const cmd = bitmapToRasterCmd(bmp);

console.log(`文件：${path.resolve(file)}`);
console.log(`位图：${bmp.width} x ${bmp.height} 点，${bmp.bytesPerLine} 字节/行`);
console.log(`ESC/POS 指令长度：${cmd.length} 字节`);

if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, cmd);
  console.log(`已写入：${path.resolve(out)}`);
}

if (showAscii) {
  console.log(bitmapToAscii(bmp, 2, 4));
  console.log(`（ESC/POS 流中可解析出 ${asciiArtFromEscPos(cmd, 2, 4).length} 张位图）`);
}
