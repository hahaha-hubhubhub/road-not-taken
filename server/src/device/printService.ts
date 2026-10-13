/**
 * 打印服务 —— B 路里的"实体设备"。
 *
 * 笔记本运行本进程，USB 连接 58mm 热敏打印机。它以"设备"身份接入服务端
 * WebSocket 网关，时序与真机完全一致：
 *
 *   hello
 *     → task             收到整张 ESC/POS 字节流，先存着，不打印
 *     → action_required  翻转由手机完成，本进程不参与，只等待授权
 *     → print_authorized 收到授权才真正写打印机（打印门控）
 *     → print_started / print_done
 *
 * 没收到 print_authorized 就打印，服务端会拦截并记 unauthorized_print
 * （PRD MVP 验收标准 3）。
 *
 * 用法：
 *   npm run print-service                                          # 默认写文件，无需打印机
 *   PRINT_TARGET=device PRINT_DEVICE=/dev/cu.usbserial-14410 npm run print-service
 *   PRINT_TARGET=stdout npm run print-service | lp -d <打印机名>
 */

import { WebSocket } from 'ws';
import {
  describeTarget,
  ensureTargetReady,
  loadPrinterTarget,
  writeReceipt,
} from './printer.js';

interface Args {
  host: string;
  port: number;
  deviceId: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? 8787),
    deviceId: 'print-01',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--host') args.host = argv[++i] ?? args.host;
    else if (a === '--port') args.port = Number(argv[++i] ?? args.port);
    else if (a === '--id') args.deviceId = argv[++i] ?? args.deviceId;
  }
  return args;
}

const args = parseArgs();
const target = loadPrinterTarget();

// 启动即校验输出目标，配置错误尽早暴露，不要等到现场出票时才失败
try {
  ensureTargetReady(target);
} catch (err) {
  console.error('[print] 输出目标不可用：', err instanceof Error ? err.message : String(err));
  process.exit(1);
}

/** 待打印的小票：收到 task 时存入，只有 print_authorized 才会被消费 */
let pending: { sessionId: string; bytes: Buffer } | null = null;
let printing = false;

function send(msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

const ws = new WebSocket(`ws://${args.host}:${args.port}/device?deviceId=${args.deviceId}`);

ws.on('open', () => {
  console.log(`[print] 已连接 ws://${args.host}:${args.port}/device（deviceId=${args.deviceId}）`);
  console.log(`[print] 输出目标：${describeTarget(target)}`);
  send({ type: 'hello', deviceId: args.deviceId, firmware: 'print-service-0.1.0' });
  send({ type: 'state', deviceId: args.deviceId, state: 'idle' });
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
      console.log(`[print] 服务端欢迎：${msg.deviceId}`);
      break;

    case 'task': {
      const bytes = Buffer.from(msg.receiptBase64 as string, 'base64');
      if (pending) {
        // 单槽设备：上一个任务还没出票就被新任务顶掉。真机上这对应纸带遗留在
        // 卷轴里，必须人工清理，所以这里明确告警而不是静默覆盖。
        console.warn(`[print] ⚠️ 上一个任务 ${pending.sessionId} 尚未出票，被 ${msg.sessionId} 顶掉`);
      }
      pending = { sessionId: msg.sessionId as string, bytes };
      console.log(`\n[print] ===== 收到小票 ${msg.sessionId}（${bytes.length} 字节）=====`);
      console.log(`[print] 标题：${msg.title}`);
      for (const s of (msg.scenes ?? []) as { index: number; act: string; caption: string }[]) {
        console.log(`[print]   第${s.index}幕·${s.act}：${s.caption}`);
      }
      console.log(`[print] 结尾：${msg.ending}`);
      console.log('[print] 已就绪，等待手机完成翻转动作与打印授权…');
      send({ type: 'state', deviceId: args.deviceId, state: 'await_action', sessionId: msg.sessionId });
      break;
    }

    case 'action_required':
      // B 路：翻转由手机的加速度计完成，本进程不参与，只记录指令内容
      console.log(`[print] 动作指令（由手机完成）：${msg.text}`);
      break;

    case 'print_authorized': {
      if (!pending) {
        console.warn('[print] 收到打印授权，但没有待打印的小票');
        break;
      }
      if (printing) {
        console.warn('[print] 正在打印中，忽略重复授权');
        break;
      }
      printing = true;
      const { sessionId, bytes } = pending;
      pending = null;
      send({ type: 'state', deviceId: args.deviceId, state: 'printing', sessionId });
      send({ type: 'print_started', sessionId, deviceId: args.deviceId });
      const startedAt = Date.now();
      try {
        await writeReceipt(target, sessionId, bytes);
        send({ type: 'print_done', sessionId, deviceId: args.deviceId });
        console.log(`[print] 打印完成（${Date.now() - startedAt}ms），小票可以取走了\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[print] 打印失败：${message}`);
        send({ type: 'error', deviceId: args.deviceId, code: 'printer', message, sessionId });
      } finally {
        printing = false;
        // 关键：出票后必须回到 idle，否则服务端的 dispatchTask 永远不再选这台设备
        // （它按 state==='idle' 找空闲设备，避免一个设备被多个 session 抢占）。
        send({ type: 'state', deviceId: args.deviceId, state: 'idle' });
      }
      break;
    }

    case 'cancel':
      console.log(`[print] 任务被取消：${msg.sessionId} ${msg.reason ?? ''}`);
      if (pending && pending.sessionId === msg.sessionId) pending = null;
      // 取消后同样要回到 idle，把设备还给调度器
      send({ type: 'state', deviceId: args.deviceId, state: 'idle' });
      break;

    case 'pong':
      break;

    default:
      break;
  }
});

ws.on('close', () => {
  console.log('[print] 连接已关闭');
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('[print] 连接失败：', err.message);
  process.exit(1);
});

// 心跳：演示间隙可能长时间空闲，保持连接并让服务端看到设备在线
setInterval(() => send({ type: 'ping' }), 30000).unref();
