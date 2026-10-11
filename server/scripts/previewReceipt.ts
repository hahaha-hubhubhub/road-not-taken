/**
 * 预览已生成的 ESC/POS 小票字节流（模拟设备打印产物 / 真机调试用）。
 *
 *   npm run receipt-preview -- out/receipt-xxxxx.bin
 */

import fs from 'node:fs';
import { asciiArtFromEscPos } from '../src/device/escpos.js';

const file = process.argv[2];
if (!file) {
  console.error('用法：npm run receipt-preview -- <receipt.bin>');
  process.exit(1);
}

const buffer = fs.readFileSync(file);
console.log(`文件：${file}（${buffer.length} 字节）`);

// 抽出可打印文本（GBK 解码）
const chunks: Buffer[] = [];
let i = 0;
while (i < buffer.length) {
  if (buffer[i] === 0x1d && buffer[i + 1] === 0x76 && buffer[i + 2] === 0x30) {
    const bytesPerLine = buffer[i + 4] | (buffer[i + 5] << 8);
    const height = buffer[i + 6] | (buffer[i + 7] << 8);
    i += 8 + bytesPerLine * height;
    continue;
  }
  if (buffer[i] === 0x1b || buffer[i] === 0x1d) {
    i += buffer[i] === 0x1b && buffer[i + 1] === 0x40 ? 2 : 3;
    continue;
  }
  chunks.push(buffer.subarray(i, i + 1));
  i++;
}

const text = Buffer.concat(chunks).toString('latin1');
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const iconv = (await import('iconv-lite')).default;
  console.log('----- 文本内容 -----');
  console.log(iconv.decode(Buffer.concat(chunks), 'gbk'));
} catch {
  console.log('----- 文本内容（latin1）-----');
  console.log(text);
}

const arts = asciiArtFromEscPos(buffer, 2, 6);
console.log(`----- 位图 ${arts.length} 张（每 2 列 / 6 行采样）-----`);
arts.forEach((art, idx) => {
  console.log(`\n[位图 ${idx + 1}]`);
  console.log(art.split('\n').slice(0, 40).join('\n'));
});
