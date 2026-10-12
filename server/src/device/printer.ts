/**
 * 打印机写入目标（B 路：笔记本驱动打印）。
 *
 * 服务端已经把整张小票排版成一条 ESC/POS 字节流（见 escpos.ts），
 * 所以这里只负责"把字节流可靠地送进打印机"，不做任何排版。
 *
 * 三种目标（PRINT_TARGET）：
 *   file    写入 out/receipt-<sessionId>.bin —— 默认，没有打印机也能联调
 *   device  写入字符设备，如 macOS 的 /dev/cu.usbserial-XXXX 或 Linux 的 /dev/usb/lp0
 *   stdout  写到标准输出，可管道给 lp -d <打印机> 或 cat > /dev/usb/lp0
 *
 * 实测：含三张插画的小票约 73KB。串口必须分块写并留间隔，否则打印机缓冲
 * 溢出会丢数据（ARCHITECTURE.md §5.4 记录过 9600 波特率下传输要 60 秒以上）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type PrinterTargetKind = 'file' | 'device' | 'stdout';

export interface PrinterTarget {
  kind: PrinterTargetKind;
  /** file 模式的输出目录 */
  dir: string;
  /** device 模式的字符设备路径 */
  devicePath: string;
  /** device 模式的波特率（USB 打印机类设备忽略此项） */
  baud: number;
  /** 单块字节数 */
  chunk: number;
  /** 块间间隔（毫秒） */
  chunkDelayMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function loadPrinterTarget(): PrinterTarget {
  const kind = (process.env.PRINT_TARGET ?? 'file').toLowerCase();
  if (kind !== 'file' && kind !== 'device' && kind !== 'stdout') {
    throw new Error(`PRINT_TARGET 只能是 file / device / stdout，当前是 "${kind}"`);
  }
  return {
    kind,
    dir: path.resolve(process.env.PRINT_DIR ?? 'out'),
    devicePath: process.env.PRINT_DEVICE ?? '',
    baud: Number(process.env.PRINT_BAUD ?? 115200),
    chunk: Number(process.env.PRINT_CHUNK ?? 512),
    chunkDelayMs: Number(process.env.PRINT_CHUNK_DELAY_MS ?? 2),
  };
}

/** 人类可读的目标描述，用于启动日志 */
export function describeTarget(t: PrinterTarget): string {
  switch (t.kind) {
    case 'file':
      return `文件（${t.dir}/receipt-<id>.bin）`;
    case 'device':
      return `字符设备 ${t.devicePath || '(未设置 PRINT_DEVICE)'} @ ${t.baud}`;
    case 'stdout':
      return '标准输出';
  }
}

/** 启动时校验目标可用，不可用直接抛错以便尽早发现配置问题 */
export function ensureTargetReady(t: PrinterTarget): void {
  if (t.kind !== 'device') return;
  if (!t.devicePath) {
    throw new Error('PRINT_TARGET=device 需要设置 PRINT_DEVICE，例如 /dev/cu.usbserial-14410');
  }
  if (!fs.existsSync(t.devicePath)) {
    throw new Error(`打印机设备不存在：${t.devicePath}（macOS 可用 ls /dev/cu.* 查看）`);
  }
}

/** 写入整张小票字节流 */
export async function writeReceipt(t: PrinterTarget, sessionId: string, bytes: Buffer): Promise<void> {
  switch (t.kind) {
    case 'file':
      writeToFile(t, sessionId, bytes);
      return;
    case 'device':
      await writeToDevice(t, bytes);
      return;
    case 'stdout':
      await writeToStdout(bytes);
      return;
  }
}

function writeToFile(t: PrinterTarget, sessionId: string, bytes: Buffer): void {
  fs.mkdirSync(t.dir, { recursive: true });
  const file = path.join(t.dir, `receipt-${sessionId}.bin`);
  fs.writeFileSync(file, bytes);
  console.log(`[print] ${bytes.length} 字节 → ${file}`);
}

async function writeToDevice(t: PrinterTarget, bytes: Buffer): Promise<void> {
  configureSerial(t);
  const fd = fs.openSync(t.devicePath, 'w');
  try {
    for (let offset = 0; offset < bytes.length; offset += t.chunk) {
      fs.writeSync(fd, bytes.subarray(offset, offset + t.chunk));
      if (t.chunkDelayMs > 0) await sleep(t.chunkDelayMs);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 串口设备需要先设波特率。USB 打印机类设备（/dev/usb/lp0）不需要，
 * 因此 stty 失败只警告不抛出——两种写法（-f / -F）都试一次以兼容 macOS 与 Linux。
 */
function configureSerial(t: PrinterTarget): void {
  for (const flag of ['-f', '-F']) {
    try {
      execFileSync('stty', [flag, t.devicePath, String(t.baud)], { stdio: 'ignore' });
      return;
    } catch {
      /* 换另一种写法重试 */
    }
  }
  console.warn(`[print] 未能设置 ${t.devicePath} 的波特率（不是串口设备则可忽略）`);
}

function writeToStdout(bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(bytes, (err) => (err ? reject(err) : resolve()));
  });
}
