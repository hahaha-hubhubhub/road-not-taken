/**
 * 模拟实体设备（硬件未到位时联调全流程）。
 *
 *   npm run mock-device -- --port 8787
 *   npm run mock-device -- --interactive   # 每轮动作等待回车
 *
 * 行为：hello → 收 task（保存 ESC/POS 字节流 + ASCII 预览）→ 收 action_required
 *       → 上报 action_progress / action_complete → 等 print_authorized
 *       → print_started / print_done
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
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { host: '127.0.0.1', port: Number(process.env.PORT ?? 8787), deviceId: 'mock-01', interactive: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') args.host = argv[++i] ?? args.host;
    else if (a === '--port') args.port = Number(argv[++i] ?? args.port);
    else if (a === '--id') args.deviceId = argv[++i] ?? args.deviceId;
    else if (a === '--interactive') args.interactive = true;
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
  send({ type: 'hello', deviceId: args.deviceId, firmware: 'mock-0.1.0' });
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
      currentSession = msg.sessionId;
      console.log(`\n[mock] ===== 收到打印任务 ${msg.sessionId} =====`);
      console.log(`[mock] 标题：${msg.title}`);
      for (const s of msg.scenes ?? []) {
        console.log(`[mock]   第${s.index}幕·${s.act}：${s.caption}`);
        console.log(`[mock]     画面：${s.imagePrompt}`);
      }
      console.log(`[mock] 结尾：${msg.ending}`);
      console.log(`[mock] 声明：${msg.disclaimer}`);

      const buffer = Buffer.from(msg.receiptBase64, 'base64');
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const file = path.join(OUT_DIR, `receipt-${msg.sessionId}.bin`);
      fs.writeFileSync(file, buffer);
      console.log(`[mock] ESC/POS 字节流 ${buffer.length} 字节 → ${file}`);

      const arts = asciiArtFromEscPos(buffer, 2, 4);
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
      console.log('[mock] 打印完成，小票可以取走了\n');
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
