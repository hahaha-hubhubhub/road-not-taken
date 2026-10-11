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

  /** 无密钥或显式开启时，用预生成案例跑通流程（断网/演示保障 OPS-01） */
  mockLlm: bool(process.env.MOCK_LLM) || !process.env.STEPFUN_API_KEY,

  /** 对外访问地址，用于生成小票二维码里的分享链接 */
  publicWebUrl: (process.env.PUBLIC_WEB_URL ?? '').replace(/\/+$/, ''),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? '*',

  sessionTtlMs: num(process.env.SESSION_TTL_HOURS, 24) * 3600 * 1000,
  /** 无硬件时，模拟一次打印的耗时 */
  simulatedPrintMs: num(process.env.SIMULATED_PRINT_MS, 2600),

  /** 58mm 热敏打印机：384 点/行 */
  print: { widthPx: 384 },

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
