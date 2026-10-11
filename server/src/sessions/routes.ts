import { Router, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { CANONICAL_DISCLAIMER, SHARE_BASE, config } from '../config.js';
import { gateway } from '../device/gateway.js';
import { DEMO_CASES } from '../llm/demoCases.js';
import { sessionStore } from './store.js';
import {
  completeAction,
  createSession,
  getPublicView,
  startGeneration,
  validateInput,
} from './service.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, model: config.mockLlm ? 'mock' : config.stepfun.model, uptime: process.uptime() });
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
  let text: string;
  try {
    text = validateInput(req.body?.text);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '输入不合规' });
    return;
  }
  startGeneration(session.id, text);
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
  if (!session) {
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
 * 演示模式：无硬件时模拟"完成翻转动作"。
 * 与真实设备走同一条状态机与打印门控，只是由服务端代替设备上报。
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
