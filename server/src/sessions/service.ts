import { bus } from '../bus.js';
import { ACT_LABELS, SHARE_BASE, config } from '../config.js';
import { gateway } from '../device/gateway.js';
import type { Move } from '../device/protocol.js';
import { InputRejectedError, generateStory } from '../llm/generate.js';
import { checkInput } from '../llm/safety.js';
import type { GenerateKind } from '../llm/generate.js';
import { makeActionCommand, sessionStore, type SessionRecord, type SessionState } from './store.js';

export interface PublicAct {
  index: number;
  name: string;
  hint: string;
  caption: string;
  imagePrompt: string;
  /** MVP 使用预置插画，图片生成接入后替换为按 session 出图 */
  imageUrl: string;
}

export interface PublicSessionView {
  sessionId: string;
  state: SessionState;
  input?: string;
  title?: string;
  acts?: PublicAct[];
  ending?: string;
  disclaimer?: string;
  action?: { text: string; moves: Move[]; done: number; total: number };
  kind?: GenerateKind;
  degraded?: boolean;
  note?: string;
  error?: string;
  shareUrl?: string;
  generateMs?: number;
  simulated?: boolean;
  delivery?: 'capsule' | 'receipt' | 'demo';
  createdAt: number;
  updatedAt: number;
  doneAt?: number;
  /** 当前是否有实体设备在线（没有则前端提供演示模拟按钮） */
  deviceConnected: boolean;
}

export function getPublicView(s: SessionRecord): PublicSessionView {
  const view: PublicSessionView = {
    sessionId: s.id,
    state: s.state,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    deviceConnected: s.deviceId ? gateway.isDeviceOnline(s.deviceId, s.deviceConnectionKey)
      : s.state === 'await_action' ? false : gateway.hasDevice(),
  };
  // 原始遗憾不放入公开结果 / 二维码返回值。
  if (s.story) {
    view.title = s.story.title;
    view.acts = s.story.scenes.map((scene, i) => ({
      index: i + 1,
      name: ACT_LABELS[i]?.name ?? `第 ${i + 1} 幕`,
      hint: ACT_LABELS[i]?.hint ?? '',
      caption: scene.caption,
      imagePrompt: scene.image_prompt,
      imageUrl: `/img/act-${i + 1}.png`,
    }));
    view.ending = s.story.ending;
    view.disclaimer = s.story.disclaimer;
  }
  if (s.action) {
    view.action = {
      text: s.action.text,
      moves: s.action.moves,
      done: s.action.done,
      total: s.action.moves.length,
    };
  }
  if (s.kind) view.kind = s.kind;
  if (s.degraded) view.degraded = true;
  if (s.note) view.note = s.note;
  if (s.error) view.error = s.error;
  if (s.shareUrl) view.shareUrl = s.shareUrl;
  if (s.generateMs !== undefined) view.generateMs = s.generateMs;
  if (s.delivery) view.delivery = s.delivery;
  if (s.simulated) view.simulated = true;
  if (s.doneAt) view.doneAt = s.doneAt;
  return view;
}

/* ------------------------------------------------------------------ */
/* 状态机                                                              */
/* ------------------------------------------------------------------ */

export function createSession(): SessionRecord {
  return sessionStore.create();
}

/** 输入预检：不合规直接报错，不调用模型 */
export function validateInput(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) {
    throw new InputRejectedError('请先写一句"如果当时我……"');
  }
  const verdict = checkInput(text);
  if (!verdict.safe && verdict.reason !== 'crisis') {
    throw new InputRejectedError(verdict.advice ?? '输入不合规，请换一种说法');
  }
  return text.trim();
}

/** 启动生成（异步，前端轮询 session 状态） */
export function startGeneration(sessionId: string, text: string, apiKey?: string, model?: string): void {
  const s = sessionStore.get(sessionId);
  if (!s) return;
  sessionStore.patch(sessionId, {
    state: 'generating',
    input: text,
    error: undefined,
    authorizedPrint: false,
    authorizedCapsule: false,
    delivery: undefined,
    story: undefined,
    action: undefined,
  });

  void generateStory(text, apiKey, model)
    .then((result) => {
      if (sessionStore.get(sessionId)?.state !== 'generating') return; // 已取消时丢弃异步结果
      // 危机分支只在手机端呈现安抚，不下发设备、打印或出胶囊。
      if (result.kind === 'care') {
        sessionStore.patch(sessionId, {
          state: 'done', story: result.story, kind: 'care', input: undefined, doneAt: Date.now(),
          generateMs: result.durationMs,
        });
        return;
      }
      const action = makeActionCommand();
      sessionStore.patch(sessionId, {
        state: 'await_action',
        story: result.story,
        kind: result.kind,
        degraded: result.degraded,
        note: result.note,
        generateMs: result.durationMs,
        action,
        authorizedPrint: false,
        shareUrl: `${SHARE_BASE}/#/r/${sessionId}`,
      });
      const updated = sessionStore.get(sessionId);
      if (updated) bus.emit('session:ready', updated);
    })
    .catch((err: unknown) => {
      if (sessionStore.get(sessionId)?.state !== 'generating') return;
      const message = err instanceof Error ? err.message : String(err);
      sessionStore.patch(sessionId, { state: 'error', error: message });
    });
}

/**
 * 动作完成 → 进入打印。
 * via=device 由真实硬件上报；via=demo 由手机完成翻转（B 路）或无硬件演示。
 * 是否授权打印取决于当前是否有打印服务在线，与 via 无关。
 */
export function completeAction(sessionId: string, via: 'device' | 'demo'): boolean {
  const s = sessionStore.get(sessionId);
  if (!s || s.state !== 'await_action') return false;
  if (via === 'demo' && s.deviceId) return false;
  if (via === 'device' && (!s.deviceId || !gateway.isDeviceOnline(s.deviceId, s.deviceConnectionKey))) return false;

  sessionStore.patch(sessionId, {
    state: 'printing',
    authorizedPrint: true,
    printStartedAt: Date.now(),
    simulated: via === 'demo',
    delivery: via === 'demo' ? 'demo' : s.delivery,
    action: s.action ? { ...s.action, done: s.action.moves.length } : undefined,
  });

  // 有打印服务在线就授权它出票；纯粹无设备演示才用定时器兜底。
  // 不能按 via 判断：B 路由手机完成翻转（走 demo 入口），此时打印服务仍在线，
  // 必须收到 print_authorized 才会真正写打印机。
  if (gateway.hasDevice()) {
    gateway.authorizePrint(sessionId);
  } else {
    setTimeout(() => {
      finishPrint(sessionId);
      setTimeout(() => finishCapsule(sessionId), config.simulatedPrintMs);
    }, config.simulatedPrintMs);
  }
  return true;
}

export function finishPrint(sessionId: string): void {
  const s = sessionStore.get(sessionId);
  if (!s || s.state !== 'printing') return;
  if (s.delivery === 'capsule' || s.delivery === 'demo') {
    sessionStore.patch(sessionId, { state: 'encapsulating', authorizedCapsule: true });
    if (s.delivery === 'capsule') {
      gateway.authorizeCapsule(sessionId);
      setTimeout(() => {
        if (sessionStore.get(sessionId)?.state === 'encapsulating') {
          gateway.cancel(sessionId, '封装超时，停止电机');
          sessionStore.patch(sessionId, { state: 'error', error: '封装超时，请工作人员处理，勿伸手取纸' });
        }
      }, config.capsuleTimeoutMs);
    }
  } else {
    sessionStore.patch(sessionId, { state: 'done', doneAt: Date.now() });
  }
}

export function finishCapsule(sessionId: string): void {
  const s = sessionStore.get(sessionId);
  if (!s || s.state !== 'encapsulating' || !s.authorizedCapsule) return;
  sessionStore.patch(sessionId, { state: 'done', doneAt: Date.now() });
}

/* ------------------------------------------------------------------ */
/* 事件编排                                                            */
/* ------------------------------------------------------------------ */

export function wireBus(): void {
  bus.on('session:ready', (session) => {
    const sent = gateway.dispatchTask(session);
    if (sent) {
      gateway.requestAction(session);
      console.log(`[service] 任务已下发设备：${session.id}`);
    } else {
      console.log(`[service] 无设备在线，进入演示模式：${session.id}`);
    }
  });

  bus.on('device:action_complete', (sessionId) => {
    completeAction(sessionId, 'device');
  });

  bus.on('device:print_done', (sessionId) => {
    finishPrint(sessionId);
  });

  bus.on('device:capsule_dispensed', (sessionId) => {
    finishCapsule(sessionId);
  });

  bus.on('device:error', ({ sessionId, code, message }) => {
    if (!sessionId) return;
    if (code === 'unauthorized_print') return; // 已拦截，仅记录
    const text =
      code === 'paper_out'
        ? '打印机缺纸，请工作人员处理'
        : code === 'paper_jam'
          ? '打印机卡纸，请工作人员处理'
          : code === 'feed_jam' || code === 'capsule_empty' || code === 'lid_open' || code === 'outlet_blocked'
            ? '胶囊机构未完成，请工作人员处理，勿将手伸入出仓口'
            : `设备错误：${message ?? code}`;
    const s = sessionStore.get(sessionId);
    if (!s || s.state === 'done' || s.state === 'error') return;
    gateway.cancel(sessionId, text);
    sessionStore.patch(sessionId, { state: 'error', error: text });
  });

  bus.on('device:disconnected', (deviceId, connectionKey) => {
    // 不把物理任务静默改成演示；断连时装置端也必须自行停止电机。
    for (const s of sessionStore.activeForDevice(deviceId, connectionKey)) {
      sessionStore.patch(s.id, { state: 'error', error: '设备断线，请工作人员检查纸带和胶囊机构' });
    }
  });
}
