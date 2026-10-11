import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { bus } from '../bus.js';
import { SHARE_BASE } from '../config.js';
import { sessionStore, type SessionRecord } from '../sessions/store.js';
import { buildReceiptBuffer } from './escpos.js';
import type { DeviceToServer, ServerToDevice } from './protocol.js';

interface DeviceConn {
  deviceId: string;
  ws: WebSocket;
  lastSeen: number;
  state: string;
  firmware?: string;
}

/**
 * 硬件设备网关（WebSocket /device）。
 * 负责：设备注册、任务下发、动作指令、打印授权门控、状态收集。
 */
export class DeviceGateway {
  private wss: WebSocketServer | null = null;
  private conns = new Map<WebSocket, DeviceConn>();

  attach(server: Server): void {
    this.wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== '/device') {
        socket.destroy();
        return;
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        let deviceId = `device-${Math.random().toString(36).slice(2, 8)}`;
        try {
          deviceId = new URL(req.url ?? '/', 'http://localhost').searchParams.get('deviceId') ?? deviceId;
        } catch {
          /* 用随机 id */
        }
        this.register(ws, deviceId);
      });
    });
  }

  private register(ws: WebSocket, deviceId: string): void {
    const conn: DeviceConn = { deviceId, ws, lastSeen: Date.now(), state: 'idle' };
    this.conns.set(ws, conn);
    console.log(`[device] 已连接：${deviceId}（当前 ${this.conns.size} 台）`);
    bus.emit('device:connected', deviceId);

    ws.on('message', (raw) => this.handleMessage(conn, raw.toString()));
    ws.on('close', () => {
      this.conns.delete(ws);
      console.log(`[device] 已断开：${deviceId}（当前 ${this.conns.size} 台）`);
      bus.emit('device:disconnected', deviceId);
    });
    ws.on('error', () => ws.close());
  }

  private send(conn: DeviceConn, msg: ServerToDevice): void {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(conn: DeviceConn, raw: string): void {
    let msg: DeviceToServer;
    try {
      msg = JSON.parse(raw) as DeviceToServer;
    } catch {
      return;
    }
    conn.lastSeen = Date.now();
    if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') return;

    switch (msg.type) {
      case 'hello': {
        conn.deviceId = msg.deviceId || conn.deviceId;
        conn.firmware = msg.firmware;
        this.send(conn, { type: 'welcome', deviceId: conn.deviceId, serverTime: Date.now() });
        break;
      }
      case 'ping': {
        this.send(conn, { type: 'pong', serverTime: Date.now() });
        break;
      }
      case 'state': {
        conn.state = msg.state;
        if (msg.sessionId) {
          sessionStore.patch(msg.sessionId, { deviceId: conn.deviceId });
        }
        break;
      }
      case 'action_progress': {
        const s = sessionStore.get(msg.sessionId);
        if (s?.action) {
          sessionStore.patch(msg.sessionId, {
            action: { ...s.action, done: Math.max(0, Math.min(msg.done, s.action.moves.length)) },
          });
        }
        break;
      }
      case 'action_complete': {
        console.log(`[device] ${conn.deviceId} 完成动作：${msg.sessionId}`);
        bus.emit('device:action_complete', msg.sessionId, conn.deviceId);
        break;
      }
      case 'print_started': {
        const s = sessionStore.get(msg.sessionId);
        if (!s?.authorizedPrint) {
          // 门控：未授权不得打印
          console.warn(`[device] ${conn.deviceId} 未授权打印被拦截：${msg.sessionId}`);
          bus.emit('device:error', {
            sessionId: msg.sessionId,
            deviceId: conn.deviceId,
            code: 'unauthorized_print',
            message: '动作未完成，打印被服务端拦截',
          });
          return;
        }
        break;
      }
      case 'print_done': {
        console.log(`[device] ${conn.deviceId} 打印完成：${msg.sessionId}`);
        bus.emit('device:print_done', msg.sessionId, conn.deviceId);
        break;
      }
      case 'error': {
        console.warn(`[device] ${conn.deviceId} 上报错误：${msg.code} ${msg.message ?? ''}`);
        bus.emit('device:error', {
          sessionId: msg.sessionId,
          deviceId: conn.deviceId,
          code: msg.code,
          message: msg.message,
        });
        break;
      }
      case 'button': {
        if (msg.button === 'cancel' && msg.sessionId) {
          sessionStore.patch(msg.sessionId, { state: 'error', error: '已在设备上取消' });
        }
        break;
      }
      default:
        break;
    }
  }

  /* ---------------- 对外能力 ---------------- */

  get connectedCount(): number {
    return this.conns.size;
  }

  hasDevice(): boolean {
    return this.conns.size > 0;
  }

  primaryDeviceId(): string | undefined {
    for (const conn of this.conns.values()) return conn.deviceId;
    return undefined;
  }

  deviceStatus(): { deviceId: string; state: string; firmware?: string; lastSeen: number }[] {
    return [...this.conns.values()].map((c) => ({
      deviceId: c.deviceId,
      state: c.state,
      firmware: c.firmware,
      lastSeen: c.lastSeen,
    }));
  }

  /** 下发打印任务；返回是否真的发给了设备 */
  dispatchTask(session: SessionRecord): boolean {
    const conn = [...this.conns.values()][0];
    if (!conn || !session.story) return false;
    const receipt = buildReceiptBuffer({
      title: session.story.title,
      scenes: session.story.scenes,
      ending: session.story.ending,
      disclaimer: session.story.disclaimer ?? '',
      shareUrl: session.shareUrl ?? SHARE_BASE,
    });
    this.send(conn, {
      type: 'task',
      sessionId: session.id,
      title: session.story.title,
      scenes: session.story.scenes.map((s, i) => ({
        index: i + 1,
        act: ['滤镜', '代价', '意外'][i] ?? `第 ${i + 1} 幕`,
        caption: s.caption,
        imagePrompt: s.image_prompt,
      })),
      ending: session.story.ending,
      disclaimer: session.story.disclaimer ?? '',
      shareUrl: session.shareUrl ?? SHARE_BASE,
      widthPx: 384,
      receiptBase64: receipt.toString('base64'),
    });
    sessionStore.patch(session.id, { deviceId: conn.deviceId });
    return true;
  }

  requestAction(session: SessionRecord): void {
    const conn = [...this.conns.values()][0];
    if (!conn || !session.action) return;
    this.send(conn, {
      type: 'action_required',
      sessionId: session.id,
      moves: session.action.moves,
      text: session.action.text,
    });
  }

  /** 打印授权：只有动作完成后才会被调用 */
  authorizePrint(sessionId: string): void {
    const conn = [...this.conns.values()][0];
    if (!conn) return;
    this.send(conn, { type: 'print_authorized', sessionId });
  }

  cancel(sessionId: string, reason = '服务端取消'): void {
    const conn = [...this.conns.values()][0];
    if (!conn) return;
    this.send(conn, { type: 'cancel', sessionId, reason });
  }
}

export const gateway = new DeviceGateway();
