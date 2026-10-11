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
    deviceConnected: gateway.hasDevice(),
  };
  if (s.input) view.input = s.input;
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
    story: undefined,
    action: undefined,
  });

  void generateStory(text, apiKey, model)
    .then((result) => {
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
      const message = err instanceof Error ? err.message : String(err);
      sessionStore.patch(sessionId, { state: 'error', error: message });
    });
}

/** 动作完成 → 进入打印（via=device 由真实硬件触发；via=demo 为无硬件演示） */
export function completeAction(sessionId: string, via: 'device' | 'demo'): boolean {
  const s = sessionStore.get(sessionId);
  if (!s || s.state !== 'await_action') return false;

  sessionStore.patch(sessionId, {
    state: 'printing',
    authorizedPrint: true,
    printStartedAt: Date.now(),
    simulated: via === 'demo',
    action: s.action ? { ...s.action, done: s.action.moves.length } : undefined,
  });

  if (via === 'device') {
    gateway.authorizePrint(sessionId);
  } else {
    setTimeout(() => finishPrint(sessionId), config.simulatedPrintMs);
  }
  return true;
}

export function finishPrint(sessionId: string): void {
  const s = sessionStore.get(sessionId);
  if (!s || s.state !== 'printing') return;
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

  bus.on('device:error', ({ sessionId, code, message }) => {
    if (!sessionId) return;
    if (code === 'unauthorized_print') return; // 已拦截，仅记录
    const text =
      code === 'paper_out'
        ? '打印机缺纸，请工作人员处理'
        : code === 'paper_jam'
          ? '打印机卡纸，请工作人员处理'
          : `设备错误：${message ?? code}`;
    sessionStore.patch(sessionId, { state: 'error', error: text });
  });

  bus.on('device:connected', () => undefined);
  bus.on('device:disconnected', () => undefined);
}
