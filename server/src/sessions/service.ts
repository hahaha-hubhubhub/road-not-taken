import { bus } from '../bus.js';
import { ACT_LABELS, SHARE_BASE, config } from '../config.js';
import { gateway } from '../device/gateway.js';
import type { Move } from '../device/protocol.js';
import { InputRejectedError, generateStory } from '../llm/generate.js';
import { generateSceneImages } from '../llm/image.js';
import { checkInput } from '../llm/safety.js';
import type { GenerateKind } from '../llm/generate.js';
import type { Story } from '../llm/schema.js';
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
  /** 图片生成状态；pending 时前端用预置图占位 */
  imageStatus?: 'pending' | 'ready' | 'failed';
  imageReadyActs?: number[];
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
  // 图片就绪情况：前端据此决定用生成图还是回落预置图
  if (s.imageStatus) view.imageStatus = s.imageStatus;
  if (s.imageReadyActs) view.imageReadyActs = s.imageReadyActs;
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
export function startGeneration(
  sessionId: string,
  text: string,
  apiKey?: string,
  model?: string,
  baseUrl?: string,
  imageModel?: string,
): void {
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

  void generateStory(text, apiKey, model, baseUrl)
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
        imageStatus: 'pending',
        imageReadyActs: [],
        shareUrl: `${SHARE_BASE}/#/r/${sessionId}`,
      });

      // 生图与状态机并行，不阻塞进入 await_action。
      // 用户在翻转设备那几秒里图片刚好在后台生成完，感知不到额外等待；
      // 若图没赶上，前端继续显示预置图，不影响取票。
      void kickOffImages(sessionId, result.story, imageModel);

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
 * 后台生成三幕插画（AI-03）。
 *
 * 与主流程解耦：失败只把 imageStatus 置 failed，前端继续用预置图，
 * 绝不让生图问题影响取票。已取消的 session 直接丢弃结果。
 */
async function kickOffImages(sessionId: string, story: Story, imageModel?: string): Promise<void> {
  const prompts = story.scenes.map((s: { image_prompt: string }) => s.image_prompt).filter(Boolean);
  if (prompts.length < 3) {
    sessionStore.patch(sessionId, { imageStatus: 'failed' });
    return;
  }
  try {
    const result = await generateSceneImages(sessionId, prompts, imageModel);
    if (!sessionStore.get(sessionId)) return; // 会话已过期
    sessionStore.patch(sessionId, {
      imageStatus: result.ok ? 'ready' : 'failed',
      imageReadyActs: result.images.map((i) => i.index),
      imageMs: result.images[0]?.ms,
    });
    console.log(
      `[image] ${sessionId}：${result.images.length}/3 成功` +
        (result.missing.length ? `，缺第 ${result.missing.join('/')} 幕（回落预置图）` : ''),
    );
  } catch (err) {
    console.warn(`[image] ${sessionId} 生图异常：`, err instanceof Error ? err.message : err);
    sessionStore.patch(sessionId, { imageStatus: 'failed' });
  }
}

/**
 * 动作完成 → 进入打印。
 *
 * via 的语义（B 路 + 胶囊架构下容易混，这里说清楚）：
 *   'device' —— 实体设备通过 WebSocket 上报 action_complete。这是唯一被允许
 *              在设备已接单时完成动作的路径，因为它意味着真实硬件确认了翻转。
 *   'demo'   —— 没有任何设备接单时的网页模拟。此时没有真机，完成动作只是
 *              让流程继续，打印/出仓都由服务端定时器模拟。
 *
 * 注意：手机上的翻转手势走的是 'demo' 入口——传感器在手机上，不在设备上。
 * 所以设备已接单时不能再按 'demo' 放行，否则等于允许网页替真机确认翻转，
 * 打印门控（PRD 验收 3）就失效了。真机链路下应由设备上报。
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

  // 只有本 session 真的分配到了设备，才授权那台设备出票。
  // 不能按"当前是否有设备在线"判断：设备可能正忙着另一个 session，此时授权它
  // 打印本 session，设备就会用手里别人的字节流却上报本 session 的 print_done——
  // 出的是错的票。没有设备接单的演示一律走定时器模拟。
  if (via === 'device' && s.deviceId && gateway.isDeviceOnline(s.deviceId, s.deviceConnectionKey)) {
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
  /**
   * 把积压的 session 补发给空闲设备。
   *
   * 两个触发点：设备上线、设备出票完成。现场两种顺序都会出现——
   * 手机先出结果而打印服务后启动，或者连续两人体验时第二人在第一人
   * 出票前就生成完了。错过下发就意味着之后无论怎么翻转都不会出票。
   */
  function dispatchBacklog(): void {
    for (const s of sessionStore.listAwaitingUnassigned()) {
      if (gateway.dispatchTask(s)) {
        gateway.requestAction(s);
        console.log(`[service] 补发积压任务：${s.id}`);
      }
    }
  }

  bus.on('session:ready', (session) => {
    const sent = gateway.dispatchTask(session);
    if (sent) {
      gateway.requestAction(session);
      console.log(`[service] 任务已下发设备：${session.id}`);
    } else {
      console.log(`[service] 无设备在线，进入演示模式：${session.id}`);
    }
  });

  /**
   * 设备上线时补发积压的任务。
   *
   * 现场顺序常常是反的：用户先在手机上输入、模型开始生成，打印服务才启动。
   * 此时 session:ready 找不到设备，任务从未下发，之后无论用户怎么翻转都不会出票，
   * 而状态机已经走到 printing——卡死在那里。
   * 所以设备一上线就把仍处于 await_action 且未分配设备的 session 补发出去。
   */
  bus.on('device:connected', () => {
    dispatchBacklog();
  });

  bus.on('device:action_complete', (sessionId) => {
    void completeAction(sessionId, 'device');
  });

  bus.on('device:print_done', (sessionId) => {
    finishPrint(sessionId);
    // 设备空闲了：把之前因为设备忙而没接到单的 session 补发出去。
    // 现场连续两人体验时，第二人在第一人出票前就生成完了，会错过下发。
    dispatchBacklog();
  });

  bus.on('device:capsule_dispensed', (sessionId) => {
    finishCapsule(sessionId);
    dispatchBacklog();
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
