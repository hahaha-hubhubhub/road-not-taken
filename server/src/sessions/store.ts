import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import type { Story } from '../llm/schema.js';
import type { Move } from '../device/protocol.js';

export type SessionState =
  | 'created'
  | 'generating'
  | 'await_action'
  | 'printing'
  | 'encapsulating'
  | 'done'
  | 'error';

export type GenerateKind = 'story' | 'care' | 'demo';

export interface ActionCommand {
  moves: Move[];
  /** 展示给用户的动作指令，如"向左翻 1 次，再向右翻 2 次" */
  text: string;
  done: number;
}

export interface SessionRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  state: SessionState;
  /** 用户原始输入 */
  input?: string;
  story?: Story;
  kind?: GenerateKind;
  degraded?: boolean;
  note?: string;
  error?: string;
  action?: ActionCommand;
  /** 已授权打印（只有动作完成后才为 true）——打印门控 */
  authorizedPrint: boolean;
  /** 输出模式由接单设备能力决定；无设备时仅为演示 */
  delivery?: 'capsule' | 'receipt' | 'demo';
  authorizedCapsule?: boolean;
  printStartedAt?: number;
  doneAt?: number;
  shareUrl?: string;
  /** 承担本次任务的设备 */
  deviceId?: string;
  /** 本进程内唯一连接标识，避免同名设备连接接管任务 */
  deviceConnectionKey?: string;
  /** 生成耗时（毫秒） */
  generateMs?: number;
  /** 演示模式（无硬件模拟）完成 */
  simulated?: boolean;
}

function newId(): string {
  return randomBytes(6).toString('base64url');
}

/** 随机翻转指令：2-4 步，左右交替出现，避免同一方向连续重复 */
export function makeActionCommand(): ActionCommand {
  const total = 2 + Math.floor(Math.random() * 3); // 2-4
  const moves: Move[] = [];
  let last: Move | null = null;
  for (let i = 0; i < total; i++) {
    let m: Move = Math.random() < 0.5 ? 'L' : 'R';
    if (m === last) m = m === 'L' ? 'R' : 'L';
    moves.push(m);
    last = m;
  }
  const groups: string[] = [];
  for (const m of moves) {
    const label = m === 'L' ? '向左翻' : '向右翻';
    const tail = groups[groups.length - 1];
    if (tail && tail.startsWith(label)) {
      groups[groups.length - 1] = `${label} ${Number(tail.split(' ')[1]) + 1} 次`;
    } else {
      groups.push(`${label} 1 次`);
    }
  }
  return { moves, text: `${groups.join('，再')}`, done: 0 };
}

class SessionStore {
  private map = new Map<string, SessionRecord>();

  create(): SessionRecord {
    const now = Date.now();
    const session: SessionRecord = {
      id: newId(),
      createdAt: now,
      updatedAt: now,
      state: 'created',
      authorizedPrint: false,
    };
    this.map.set(session.id, session);
    return session;
  }

  get(id: string): SessionRecord | undefined {
    return this.map.get(id);
  }

  patch(id: string, patch: Partial<SessionRecord>): SessionRecord | undefined {
    const s = this.map.get(id);
    if (!s) return undefined;
    Object.assign(s, patch, { updatedAt: Date.now() });
    return s;
  }

  /** 清除超过 TTL 的 session（OPS-03：文本与结果默认 24 小时删除） */
  purge(now = Date.now()): number {
    let removed = 0;
    for (const [id, s] of this.map) {
      if (now - s.updatedAt > config.sessionTtlMs) {
        this.map.delete(id);
        removed++;
      }
    }
    return removed;
  }

  activeForDevice(deviceId: string, connectionKey?: string): SessionRecord[] {
    return [...this.map.values()].filter((s) => s.deviceId === deviceId &&
      (!connectionKey || s.deviceConnectionKey === connectionKey) &&
      (s.state === 'await_action' || s.state === 'printing' || s.state === 'encapsulating'));
  }

  get size(): number {
    return this.map.size;
  }
}

export const sessionStore = new SessionStore();
