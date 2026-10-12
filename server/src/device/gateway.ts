import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { bus } from '../bus.js';
import { SHARE_BASE } from '../config.js';
import { sessionStore, type SessionRecord } from '../sessions/store.js';
import { buildCapsuleInsertBuffer, buildReceiptBuffer } from './escpos.js';
import type { DeviceToServer, ServerToDevice } from './protocol.js';

interface DeviceConn {
  deviceId: string;
  connectionKey: string;
  ws: WebSocket;
  lastSeen: number;
  state: string;
  firmware?: string;
  capsuleCapable: boolean;
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
    const conn: DeviceConn = { deviceId, connectionKey: randomUUID(), ws, lastSeen: Date.now(), state: 'idle', capsuleCapable: false };
    this.conns.set(ws, conn);
    console.log(`[device] 已连接：${deviceId}（当前 ${this.conns.size} 台）`);
    bus.emit('device:connected', deviceId);

    ws.on('message', (raw) => this.handleMessage(conn, raw.toString()));
    ws.on('close', () => {
      this.conns.delete(ws);
      bus.emit('device:disconnected', conn.deviceId, conn.connectionKey);
      console.log(`[device] 已断开：${deviceId}（当前 ${this.conns.size} 台）`);
    });
    ws.on('error', () => ws.close());
  }

  private owns(conn: DeviceConn, sessionId: string): boolean {
    return sessionStore.get(sessionId)?.deviceConnectionKey === conn.connectionKey;
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
        // 握手中的任意 ID 不能改写 URL 注册的身份；真正设备鉴权仍待实现。
        conn.firmware = msg.firmware;
        conn.capsuleCapable = msg.capabilities?.capsule === true;
        this.send(conn, { type: 'welcome', deviceId: conn.deviceId, serverTime: Date.now() });
        break;
      }
      case 'ping': {
        this.send(conn, { type: 'pong', serverTime: Date.now() });
        break;
      }
      case 'state': {
        conn.state = msg.state;
        // 状态消息只用于设备监控，不能改写 session 归属。
        break;
      }
      case 'action_progress': {
        const s = sessionStore.get(msg.sessionId);
        if (s?.state === 'await_action' && this.owns(conn, msg.sessionId) && s.action) {
          sessionStore.patch(msg.sessionId, {
            action: { ...s.action, done: Math.max(0, Math.min(msg.done, s.action.moves.length)) },
          });
        }
        break;
      }
      case 'action_complete': {
        console.log(`[device] ${conn.deviceId} 完成动作：${msg.sessionId}`);
        const s = sessionStore.get(msg.sessionId);
        if (s?.state === 'await_action' && this.owns(conn, msg.sessionId) && s.action?.done === s.action?.moves.length) {
          bus.emit('device:action_complete', msg.sessionId, conn.deviceId);
        }
        break;
      }
      case 'print_started': {
        const s = sessionStore.get(msg.sessionId);
        if (!s?.authorizedPrint || !this.owns(conn, msg.sessionId) || s.state !== 'printing') {
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
        const s = sessionStore.get(msg.sessionId);
        if (s?.authorizedPrint && this.owns(conn, msg.sessionId) && s.state === 'printing') {
          bus.emit('device:print_done', msg.sessionId, conn.deviceId);
        }
        break;
      }
      case 'capsule_dispensed': {
        const s = sessionStore.get(msg.sessionId);
        if (s?.state === 'encapsulating' && s.authorizedCapsule && s.delivery === 'capsule' &&
            this.owns(conn, msg.sessionId) && msg.paperCaptured === true &&
            msg.capsuleClosed === true && msg.outletClear === true) {
          bus.emit('device:capsule_dispensed', msg.sessionId, conn.deviceId);
        } else {
          console.warn(`[device] 拒绝无效的胶囊完成信号：${msg.sessionId}`);
        }
        break;
      }
      case 'error': {
        console.warn(`[device] ${conn.deviceId} 上报错误：${msg.code} ${msg.message ?? ''}`);
        if (msg.sessionId && !this.owns(conn, msg.sessionId)) break;
        bus.emit('device:error', {
          sessionId: msg.sessionId,
          deviceId: conn.deviceId,
          code: msg.code,
          message: msg.message,
        });
        break;
      }
      case 'button': {
        if (msg.button === 'cancel' && msg.sessionId && this.owns(conn, msg.sessionId)) {
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

  isDeviceOnline(deviceId: string, connectionKey?: string): boolean {
    return [...this.conns.values()].some((c) => c.deviceId === deviceId &&
      (!connectionKey || c.connectionKey === connectionKey) && c.ws.readyState === WebSocket.OPEN);
  }

  primaryDeviceId(): string | undefined {
    for (const conn of this.conns.values()) return conn.deviceId;
    return undefined;
  }

  deviceStatus(): { deviceId: string; state: string; firmware?: string; capsuleCapable: boolean; lastSeen: number }[] {
    return [...this.conns.values()].map((c) => ({
      deviceId: c.deviceId,
      state: c.state,
      firmware: c.firmware,
      capsuleCapable: c.capsuleCapable,
      lastSeen: c.lastSeen,
    }));
  }

  /** 下发打印任务；返回是否真的发给了设备 */
  dispatchTask(session: SessionRecord): boolean {
    const conn = [...this.conns.values()].find((c) =>
      c.ws.readyState === WebSocket.OPEN && c.state === 'idle' && sessionStore.activeForDevice(c.deviceId, c.connectionKey).length === 0);
    if (!conn || !session.story) return false;
    const delivery = conn.capsuleCapable ? 'capsule' : 'receipt';
    const options = {
      title: session.story.title,
      scenes: session.story.scenes,
      ending: session.story.ending,
      disclaimer: session.story.disclaimer ?? '',
      shareUrl: session.shareUrl ?? SHARE_BASE,
    };
    const receipt = delivery === 'capsule'
      ? buildCapsuleInsertBuffer({ ...options, sessionId: session.id })
      : buildReceiptBuffer(options);
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
      delivery,
    });
    sessionStore.patch(session.id, { deviceId: conn.deviceId, deviceConnectionKey: conn.connectionKey, delivery });
    return true;
  }

  requestAction(session: SessionRecord): void {
    const conn = [...this.conns.values()].find((c) => c.connectionKey === session.deviceConnectionKey);
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
    const s = sessionStore.get(sessionId);
    const conn = [...this.conns.values()].find((c) => c.connectionKey === s?.deviceConnectionKey);
    if (!conn) return;
    this.send(conn, { type: 'print_authorized', sessionId });
  }

  authorizeCapsule(sessionId: string): void {
    const s = sessionStore.get(sessionId);
    const conn = [...this.conns.values()].find((c) => c.connectionKey === s?.deviceConnectionKey);
    if (conn && s?.delivery === 'capsule') this.send(conn, { type: 'capsule_authorized', sessionId });
  }

  cancel(sessionId: string, reason = '服务端取消'): void {
    const s = sessionStore.get(sessionId);
    const conn = [...this.conns.values()].find((c) => c.connectionKey === s?.deviceConnectionKey);
    if (!conn) return;
    this.send(conn, { type: 'cancel', sessionId, reason });
  }
}

export const gateway = new DeviceGateway();
