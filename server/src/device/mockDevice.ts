/**
 * 模拟实体设备（硬件未到位时联调全流程）。
 *
 *   npm run mock-device -- --port 8787
 *   npm run mock-device -- --interactive   # 每轮动作等待回车
 *
 * 行为：hello(capsule) → 收 task（默认不持久化内容；--save-receipt 才保存调试文件）
 *       → 动作上报 → 打印授权/完成 → 封装授权 → 模拟传感器确认出仓。
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { WebSocket } from 'ws';
import { asciiArtFromEscPos } from './escpos.js';

interface Args {
  host: string;
  port: number;
  deviceId: string;
  interactive: boolean;
  saveReceipt: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { host: '127.0.0.1', port: Number(process.env.PORT ?? 8787), deviceId: 'mock-01', interactive: false, saveReceipt: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') args.host = argv[++i] ?? args.host;
    else if (a === '--port') args.port = Number(argv[++i] ?? args.port);
    else if (a === '--id') args.deviceId = argv[++i] ?? args.deviceId;
    else if (a === '--interactive') args.interactive = true;
    else if (a === '--save-receipt') args.saveReceipt = true;
  }
  return args;
}

const args = parseArgs();
const OUT_DIR = path.resolve('out');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const waitEnter = (): Promise<void> =>
  new Promise((resolve) => rl.question('  [mock] 按回车完成本轮动作…', () => resolve()));

const ws = new WebSocket(`ws://${args.host}:${args.port}/device?deviceId=${args.deviceId}`);
let currentSession: string | null = null;

function send(msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

ws.on('open', () => {
  console.log(`[mock] 已连接 ws://${args.host}:${args.port}/device（deviceId=${args.deviceId}）`);
  send({ type: 'hello', deviceId: args.deviceId, firmware: 'mock-0.2.0', capabilities: { capsule: true } });
});

ws.on('message', async (raw) => {
  let msg: Record<string, any>;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return;
  }

  switch (msg.type) {
    case 'welcome':
      console.log(`[mock] 服务端欢迎：${msg.deviceId}`);
      break;

    case 'task': {
      const isUpdate = currentSession === msg.sessionId;
      currentSession = msg.sessionId;
      console.log(`\n[mock] ===== ${isUpdate ? '任务内容已更新' : '收到打印任务'} ${msg.sessionId} =====`);
      console.log(`[mock] 交付模式：${msg.delivery}；默认不打印用户内容到终端，也不落盘`);
      if (isUpdate) console.log('[mock] （生图就绪，小票已换成含生成图的版本）');

      const buffer = Buffer.from(msg.receiptBase64, 'base64');
      if (args.saveReceipt) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        const file = path.join(OUT_DIR, `receipt-${msg.sessionId}.bin`);
        fs.writeFileSync(file, buffer, { mode: 0o600 });
        console.log(`[mock] 调试文件（需手动删除）${buffer.length} 字节 → ${file}`);
      }

      const arts = args.saveReceipt ? asciiArtFromEscPos(buffer, 2, 4) : [];
      arts.slice(0, 3).forEach((art, i) => {
        console.log(`[mock] --- 位图预览 ${i + 1}/${arts.length}（.#=黑点，每 2 列/4 行采样）---`);
        console.log(art.split('\n').slice(0, 24).join('\n'));
      });
      break;
    }

    case 'action_required': {
      const moves: string[] = msg.moves ?? [];
      console.log(`\n[mock] 动作指令：${msg.text}（${moves.map((m: string) => (m === 'L' ? '左' : '右')).join(' ')}）`);
      send({ type: 'state', deviceId: args.deviceId, state: 'await_action', sessionId: msg.sessionId });

      for (let i = 0; i < moves.length; i++) {
        if (args.interactive) await waitEnter();
        else await sleep(900);
        send({ type: 'action_progress', sessionId: msg.sessionId, done: i + 1, total: moves.length });
        console.log(`[mock] 完成 ${i + 1}/${moves.length}：${moves[i] === 'L' ? '向左翻' : '向右翻'}`);
      }
      send({ type: 'action_complete', sessionId: msg.sessionId, deviceId: args.deviceId });
      console.log('[mock] 动作全部完成，等待打印授权…');
      break;
    }

    case 'print_authorized': {
      console.log('[mock] 收到打印授权，开始打印');
      send({ type: 'state', deviceId: args.deviceId, state: 'printing', sessionId: msg.sessionId });
      send({ type: 'print_started', sessionId: msg.sessionId, deviceId: args.deviceId });
      await sleep(800);
      send({ type: 'print_done', sessionId: msg.sessionId, deviceId: args.deviceId });
      console.log('[mock] 打印完成，等待封装授权…');
      break;
    }

    case 'capsule_authorized': {
      if (msg.sessionId !== currentSession) break;
      send({ type: 'state', deviceId: args.deviceId, state: 'encapsulating', sessionId: msg.sessionId });
      console.log('[mock] 模拟卷纸、封壳和出仓（非真实硬件）…');
      await sleep(1500);
      send({ type: 'capsule_dispensed', sessionId: msg.sessionId, deviceId: args.deviceId,
        paperCaptured: true, capsuleClosed: true, outletClear: true });
      send({ type: 'state', deviceId: args.deviceId, state: 'idle' });
      console.log('[mock] 模拟胶囊已出仓\n');
      break;
    }

    case 'cancel':
      console.log(`[mock] 任务被取消：${msg.sessionId} ${msg.reason ?? ''}`);
      break;

    case 'pong':
      break;

    default:
      break;
  }
});

ws.on('close', () => {
  console.log('[mock] 连接已关闭');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[mock] 连接失败：', err.message);
  process.exit(1);
});
