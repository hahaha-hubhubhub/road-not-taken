import { Router, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import { CANONICAL_DISCLAIMER, SHARE_BASE, config } from '../config.js';
import { gateway } from '../device/gateway.js';
import { DEMO_CASES } from '../llm/demoCases.js';
import { InputRejectedError, generateStory } from '../llm/generate.js';
import { parallelRouter } from '../llm/parallel.js';
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

apiRouter.use('/parallel', parallelRouter);

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

/**
 * 手机纯文本预览（`/regret-remedy/` 用）。
 *
 * 与首页热敏票共用同一条生成链路和同一份安全策略，区别只有三点：
 * 1. 不创建 session、不碰硬件、不打印、不落盘；
 * 2. 不打印，所以输入上限放宽到 1000 字（热敏票只印得下 100 字）；
 * 3. 返回值对齐手机端要的字段：每格要有 heading / detail，外加一封「另一个你」的来信。
 */
const ACT_HEADINGS = ['看起来', '后来', '那边的我'];

/** 模型漏写来信时的兜底：宁可短，也不要让信纸页空着或说错话 */
function fallbackLetter(ending: string): string {
  return `给现在的你：\n\n那边的我这几天也在加班，回信晚了，别怪我。\n\n${ending}\n\n另一个你`;
}

apiRouter.post('/stories/preview', async (req: Request, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 1000) {
    res.status(400).json({ error: '请输入不超过 1000 字的选择' });
    return;
  }
  try {
    const result = await generateStory(
      text,
      req.header('x-stepfun-api-key') || undefined,
      req.header('x-stepfun-model') || undefined,
      req.header('x-stepfun-base-url') || undefined,
      1000,
    );
    const { story, kind } = result;
    res.json({
      kind,
      degraded: result.degraded,
      durationMs: result.durationMs,
      attempts: result.attempts,
      story: {
        title: story.title,
        scenes: story.scenes.map((scene, i) => ({
          heading: scene.heading || ACT_HEADINGS[i] || '',
          detail: scene.detail || scene.caption,
          caption: scene.caption,
        })),
        letter: kind === 'care' ? undefined : story.letter?.trim() || fallbackLetter(story.ending),
      },
    });
  } catch (err) {
    // 不转发提供商原始错误（可能含请求信息）；未配置密钥时引导去首页设置
    res.status(err instanceof InputRejectedError ? 400 : 503).json({
      error:
        err instanceof InputRejectedError
          ? err.message
          : '生成未完成，请检查模型设置或稍后重试。未配置密钥时请到首页设置。',
    });
  }
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
