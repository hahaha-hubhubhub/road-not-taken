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
    maxTokens: num(process.env.STEPFUN_MAX_TOKENS, 8000),
    timeoutMs: num(process.env.STEPFUN_TIMEOUT_MS, 60000),
    /**
     * 推理强度。注意：step-5-preview 的思考过程也计入 completion_tokens，
     * max_tokens 必须留够（实测思考 1000-2500 tokens + 正文约 500）。
     * 实测（同一 prompt）：medium ≈ 21-32s，low ≈ 28-41s，high ≈ 39s。
     */
    reasoningEffort: (process.env.STEPFUN_REASONING_EFFORT ?? 'medium') as 'low' | 'medium' | 'high',
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
