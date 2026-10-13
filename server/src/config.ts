import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（server/ 的上一级） */
export const ROOT_DIR = path.resolve(here, '..', '..');
export const WEB_DIR = path.join(ROOT_DIR, 'web');
export const ASSETS_DIR = path.join(ROOT_DIR, 'assets');

// 支持仓库根目录的 .env（推荐）和 server/.env（本地覆盖）
dotenv.config({ path: path.join(ROOT_DIR, '.env') });
dotenv.config();

const bool = (v: string | undefined): boolean => v === '1' || v === 'true';
const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  port: num(process.env.PORT, 8787),

  stepfun: {
    apiKey: process.env.STEPFUN_API_KEY ?? '',
    baseUrl: (process.env.STEPFUN_BASE_URL ?? 'https://api.stepfun.com/v1').replace(/\/+$/, ''),
    model: process.env.STEPFUN_MODEL ?? 'step-5-preview',
    /**
     * 必须留够思考额度。实测（2026-10-13，models-proxy，完整三幕 prompt）：
     * 单次 completion 在 4500-7200 token 之间，绝大部分是思考，
     * 正文只有约 1300-1460 字符（约 600 token）。
     *
     *   max_tokens 4000 → 74s，finish_reason=length，**正文为空**（不可用）
     *   max_tokens 8000 → 54-197s，正文完整（当前默认）
     *
     * 早前一份「low + 4000 → 33s 且完整」的实测不可复现，已作废：
     * 模型的思考长度波动很大，4000 会被吃光导致返回空内容。
     * 截断时代码会自动加额 1.5 倍重试（上限 12000），所以 8000 是起点不是终点。
     */
    maxTokens: num(process.env.STEPFUN_MAX_TOKENS, 8000),
    /**
     * 超时。实测完整 prompt 的延迟是 77-129s（直连网关 5 次采样，中位约 92s），
     * SDK 路径观察到过 197s。早前 60s 会导致绝大多数请求被判超时并降级成
     * 演示案例——用户看到与输入无关的故事却以为在实时生成。
     * 150s 覆盖采样到的绝大多数情况；真挂了再由降级兜底。
     */
    timeoutMs: num(process.env.STEPFUN_TIMEOUT_MS, 150000),
    /**
     * 推理强度。low 已是该网关支持的最低档；网关上文本模型只有
     * step-5-preview:stepfun 一个，没有更快的可换。
     */
    reasoningEffort: (process.env.STEPFUN_REASONING_EFFORT ?? 'low') as 'low' | 'medium' | 'high',
  },

  /**
   * 图片生成（AI-03）。gpt-image-2 走 models-proxy 网关，与文本用的 StepFun
   * 主站不是同一个 base URL，所以单独一组配置。
   *
   * Key 只从 .env 读，不要写进代码或提交。未配置时生图自动关闭，
   * 手机上回落预置图，不影响主流程。
   *
   * 实测（2026-10-12）：单张约 25s，三张并行约 34s。timeoutMs 按单张的
   * 3 倍余量给，因为并行时网关排队可能更慢。
   */
  image: {
    apiKey: process.env.IMAGE_API_KEY ?? '',
    baseUrl: (process.env.IMAGE_BASE_URL ?? 'https://models-proxy.stepfun-inc.com/v1').replace(/\/+$/, ''),
    model: process.env.IMAGE_MODEL ?? 'gpt-image-2',
    timeoutMs: num(process.env.IMAGE_TIMEOUT_MS, 90000),
    get enabled(): boolean {
      return Boolean(this.apiKey);
    },
  },

  /** 显式开启时用预生成案例跑通流程（断网演示）；没有 Key 时不再是静默降级，而是报错提示 */
  mockLlm: bool(process.env.MOCK_LLM),
  /** 服务端 .env 是否配置了 Key */
  hasServerKey: Boolean(process.env.STEPFUN_API_KEY),

  /** 对外访问地址，用于生成小票二维码里的分享链接 */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? '').replace(/\/+$/, ''),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',

  sessionTtlMs: num(process.env.SESSION_TTL_HOURS, 24) * 3600 * 1000,
  /** 无硬件时，模拟一次打印的耗时 */
  simulatedPrintMs: num(process.env.SIMULATED_PRINT_MS, 2600),
  capsuleTimeoutMs: num(process.env.CAPSULE_TIMEOUT_MS, 30000),

  /** 58mm 热敏打印机：384 点/行 */
  print: {
    widthPx: 384,
    /**
     * 插画边长（点）。384 会占满整张纸宽，插画反而压过文字；
     * 256 让插画退成一块"图版"，文字重新成为小票主体。
     */
    imageSizePx: num(process.env.PRINT_IMAGE_SIZE_PX, 256),
  },

  /** 每次生成允许的 LLM 尝试次数（仅校验失败才重试；断网/超时立即降级） */
  maxAttempts: 2,
};

/** 分享链接基地址 */
export const SHARE_BASE = config.publicWebUrl || `http://localhost:${config.port}`;

/** 固定免责声明：所有结果必须携带（PRD 原则 4 / 验收标准） */
export const CANONICAL_DISCLAIMER = '这是模型生成的虚构故事，不是人生预测。';

/** 三幕固定标签（服务端渲染，避免模型漂移） */
export const ACT_LABELS = [
  { index: 1, name: '滤镜', hint: '那条路最诱人的样子' },
  { index: 2, name: '代价', hint: '没被想象到的日常' },
  { index: 3, name: '意外', hint: '荒诞或意外的落点' },
] as const;
