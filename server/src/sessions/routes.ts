import { Router, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { CANONICAL_DISCLAIMER, SHARE_BASE, config } from '../config.js';
import { gateway } from '../device/gateway.js';
import { DEMO_CASES } from '../llm/demoCases.js';
import { imagePath } from '../llm/image.js';
import { sessionStore } from './store.js';
import {
  completeAction,
  createSession,
  getPublicView,
  startGeneration,
  validateInput,
} from './service.js';

export const apiRouter = Router();

/** API 响应不缓存（轮询接口 + 避免 304 无 content-type 干扰前端探测） */
apiRouter.use((_req: Request, res: Response, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    model: config.stepfun.model,
    mockLlm: config.mockLlm,
    hasServerKey: config.hasServerKey,
    uptime: process.uptime(),
  });
});

/** 演示案例（断网 / 无密钥时前端可离线展示） */
apiRouter.get('/demo/cases', (_req: Request, res: Response) => {
  res.json({
    cases: DEMO_CASES.map((c) => ({
      id: c.id,
      label: c.label,
      input: c.input,
      title: c.title,
      acts: c.scenes.map((s, i) => ({
        index: i + 1,
        name: ['滤镜', '代价', '意外'][i],
        caption: s.caption,
        imagePrompt: s.image_prompt,
        imageUrl: `/img/act-${i + 1}.png`,
      })),
      ending: c.ending,
      disclaimer: CANONICAL_DISCLAIMER,
    })),
  });
});

/** 设备在线状态（前端据此决定：等硬件 / 演示模拟） */
apiRouter.get('/device/status', (_req: Request, res: Response) => {
  res.json({ connected: gateway.hasDevice(), devices: gateway.deviceStatus() });
});

/** 创建 session */
apiRouter.post('/sessions', (_req: Request, res: Response) => {
  const session = createSession();
  res.status(201).json(getPublicView(session));
});

/** 提交"如果当时……"，开始生成（异步，轮询 GET /sessions/:id） */
apiRouter.post('/sessions/:id/generate', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session 不存在或已过期' });
    return;
  }
  if (session.state !== 'created') {
    res.status(409).json({ error: '本次体验已提交，请创建新 session', state: session.state });
    return;
  }
  let text: string;
  try {
    text = validateInput(req.body?.text);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '输入不合规' });
    return;
  }
  // 页面「设置」里填的 Key / 模型优先于服务端 .env
  const apiKey = req.header('x-stepfun-api-key') || undefined;
  const model = req.header('x-stepfun-model') || undefined;
  startGeneration(session.id, text, apiKey, model);
  res.status(202).json(getPublicView(sessionStore.get(session.id)!));
});

/** 查询 session 状态 */
apiRouter.get('/sessions/:id', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session 不存在或已过期' });
    return;
  }
  res.json(getPublicView(session));
});

/** 分享用二维码（小票上的同一张，PNG，480px） */
apiRouter.get('/sessions/:id/qr.png', async (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session || session.kind === 'care') {
    res.status(404).end();
    return;
  }
  const url = session.shareUrl ?? `${SHARE_BASE}/#/r/${session.id}`;
  const buf = await QRCode.toBuffer(url, {
    type: 'png',
    margin: 1,
    width: 480,
    color: { dark: '#000000', light: '#ffffff' },
  });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
});

/** 分享页 / 结果页数据 */
apiRouter.get('/sessions/:id/result', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session 不存在或已过期（结果默认保留 24 小时）' });
    return;
  }
  res.json(getPublicView(session));
});

/**
 * 生成图（AI-03）。仅在图片已生成时返回，否则 404 让前端回落预置图。
 * 图片不入小票（胶囊内芯只装文字，见 CAPSULE_PRD C-04），只在手机端展示。
 */
apiRouter.get('/sessions/:id/images/:index', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).end();
    return;
  }
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 1 || index > 3) {
    res.status(400).json({ error: 'index 必须是 1-3' });
    return;
  }
  const file = imagePath(session.id, index);
  if (!file) {
    // 未生成 / 生成失败 / 已过期：让前端继续用预置图
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.sendFile(file);
});

/**
 * 手机上报翻转进度（HW-03：传感器在手机上，不在设备上）。
 *
 * 与 simulate-action 的区别：这个是用户真的翻了手机，逐格上报；
 * simulate-action 是无任何设备时的整段模拟。设备已接单时也允许走这个接口，
 * 因为翻转确实发生在手机上——设备只负责打印和出仓，不负责感知翻转。
 *
 * body: { done: number }  已完成的格数（1..total）
 * 达到 total 时服务端授权打印（打印门控：未完成不授权）。
 */
apiRouter.post('/sessions/:id/flip-progress', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session 不存在或已过期' });
    return;
  }
  if (session.state !== 'await_action' || !session.action) {
    res.status(409).json({ error: '当前状态不能上报翻转进度', state: session.state });
    return;
  }

  const total = session.action.moves.length;
  const raw = Number(req.body?.done);
  if (!Number.isInteger(raw) || raw < 1 || raw > total) {
    res.status(400).json({ error: `done 必须是 1-${total} 的整数` });
    return;
  }

  const done = Math.max(session.action.done, raw); // 只前进不回退
  if (done < total) {
    sessionStore.patch(session.id, { action: { ...session.action, done } });
    res.json(getPublicView(sessionStore.get(session.id)!));
    return;
  }

  // 全部完成。有设备接单时走设备入口（由服务端授权打印）；
  // 没有设备时这就是一次普通演示，回落 demo 入口，否则动作完成了状态却不动，
  // 前端会一直停在"打印中"。
  const via = session.deviceId ? 'device' : 'demo';
  const ok = completeAction(session.id, via);
  if (!ok) {
    res.status(409).json({ error: '完成动作失败，请重试', state: session.state });
    return;
  }
  res.json(getPublicView(sessionStore.get(session.id)!));
});

/**
 * 演示模式：无任何设备接单时，由网页模拟"完成翻转动作"。
 * 与真实设备走同一条状态机与打印门控，只是由服务端代替设备上报。
 * 设备已接单时禁用——那意味着有真机在场，翻转应由手机传感器通过
 * flip-progress 上报，不能整段假装完成。
 */
apiRouter.post('/sessions/:id/simulate-action', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session 不存在或已过期' });
    return;
  }
  const ok = completeAction(session.id, 'demo');
  if (!ok) {
    res.status(409).json({ error: '当前状态不能执行动作', state: session.state });
    return;
  }
  res.json(getPublicView(sessionStore.get(session.id)!));
});

/** 实体按钮：取消 */
apiRouter.post('/sessions/:id/cancel', (req: Request, res: Response) => {
  const session = sessionStore.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'session 不存在或已过期' });
    return;
  }
  gateway.cancel(session.id);
  sessionStore.patch(session.id, { state: 'error', error: '已取消' });
  res.json(getPublicView(sessionStore.get(session.id)!));
});
