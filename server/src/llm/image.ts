/**
 * 图片生成（AI-03）：gpt-image-2，按幕生成三张插画。
 *
 * 走 models-proxy 网关，OpenAI 兼容的 /images/generations。
 * 与文本生成并行启动，不要串行等——实测单张约 25s，三张并行约 34s，
 * 而文本本身要 21-34s，串行会把总时长推到 60s 以上。
 *
 * 关键约束（热敏纸 / 手机端的取舍）：
 *   - 图上手机端（彩色屏），不是 1-bit 热敏纸。纸路继续用预置图版兜底，
 *     见 escpos.ts 的 presetImageBitmap()。
 *   - prompt 由模型每幕生成（image_prompt），这里只负责追加统一的风格后缀，
 *     保证三张图是同一套画风、同一个人物设定。
 *   - 失败不阻塞主流程：任何一张失败都只影响那一幕，回落到预置图。
 */

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export interface SceneImage {
  index: number;          // 1..3
  b64: string;            // PNG base64
  mimeType: string;
  /** 生成该图实际消耗的毫秒数 */
  ms: number;
}

export interface GenerateImagesResult {
  ok: boolean;
  images: SceneImage[];
  /** 未成功生成的幕次（调用方据此回落预置图） */
  missing: number[];
  error?: string;
}

/**
 * 统一风格后缀：三张图必须看起来是同一套作品。
 *
 *  Negative约束是实测踩出来的：只写"画一个App图标设计"时，模型会画一个
 * 图片占位符图标（山形+太阳的通用符号）而不是具体场景——因为"图标"这个词
 * 本身就是抽象指令。所以这里显式要求画具体的人和物，并禁掉占位符类元素。
 */
const STYLE_SUFFIX =
  'Draw a concrete scene with real objects and a person in it. ' +
  'Never draw placeholder graphics, image frames, icons-as-subjects, ' +
  'blank screens, or empty panels — if the subject involves a screen or artwork, ' +
  'show what is actually on it or show the person working on it. ' +
  'Style: black and white line drawing, thick bold outlines, flat high contrast, ' +
  'minimal detail, no gradients, no gray fills, clean composition with generous ' +
  'negative space. Keep the same character and setting across all three images. ' +
  'Aspect ratio 1:1. Do not include any text, letters, numbers, or watermarks.';

/** 输出目录：server/out/images/<sessionId>-<n>.png */
function imageDir(): string {
  return path.resolve(process.env.PRINT_IMAGE_DIR ?? 'out/images');
}

function saveImage(sessionId: string, index: number, b64: string): string {
  const dir = imageDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}-${index}.png`);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

/** 单张生成。超时/失败都抛错，由调用方决定是否回落。 */
async function generateOne(
  prompt: string,
  timeoutMs: number,
  model: string,
): Promise<{ b64: string; mimeType: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${config.image.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.image.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: `${prompt}\n\n${STYLE_SUFFIX}`,
        n: 1,
        size: '1024x1024',
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      data?: { b64_json?: string; url?: string }[];
      output_format?: string;
    };

    const item = json.data?.[0];
    if (!item) throw new Error('响应里没有 data[0]');

    // 优先用 b64_json；只有 url 时再回落到下载（代理两种都可能返回）
    if (item.b64_json) {
      return { b64: item.b64_json, mimeType: `image/${json.output_format ?? 'png'}` };
    }
    if (item.url) {
      const img = await fetch(item.url, { signal: controller.signal });
      if (!img.ok) throw new Error(`下载图片失败 HTTP ${img.status}`);
      const buf = Buffer.from(await img.arrayBuffer());
      return { b64: buf.toString('base64'), mimeType: img.headers.get('content-type') ?? 'image/png' };
    }
    throw new Error('data[0] 既没有 b64_json 也没有 url');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 并行生成三幕插画。
 *
 * @param prompts 长度 3 的提示词数组（来自模型输出的 image_prompt）
 * @returns 成功列表 + 缺失幕次。缺失由调用方回落预置图，不要让整次体验失败。
 */
export async function generateSceneImages(
  sessionId: string,
  prompts: string[],
  /** 页面「设置」里临时指定的生图模型，优先于 .env 的 IMAGE_MODEL */
  modelOverride?: string,
): Promise<GenerateImagesResult> {
  if (!config.image.enabled) {
    return { ok: false, images: [], missing: [1, 2, 3], error: '图片生成未配置（IMAGE_API_KEY 为空）' };
  }
  if (prompts.length < 3) {
    return { ok: false, images: [], missing: [1, 2, 3], error: '提示词不足三幕' };
  }

  const started = Date.now();
  const model = (modelOverride ?? '').trim() || config.image.model;

  // 三张并行：串行约 75s，并行约 34s（实测）
  const settled = await Promise.allSettled(
    prompts
      .slice(0, 3)
      .map((p, i) => generateOne(p, config.image.timeoutMs, model).then((r) => ({ ...r, index: i + 1 }))),
  );

  const images: SceneImage[] = [];
  const missing: number[] = [];

  settled.forEach((r, i) => {
    const index = i + 1;
    if (r.status === 'fulfilled') {
      try {
        saveImage(sessionId, index, r.value.b64);
        images.push({ index, b64: r.value.b64, mimeType: r.value.mimeType, ms: Date.now() - started });
      } catch (err) {
        missing.push(index);
        console.warn(`[image] 第 ${index} 幕保存失败：`, err instanceof Error ? err.message : err);
      }
    } else {
      missing.push(index);
      console.warn(
        `[image] 第 ${index} 幕生成失败：`,
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
    }
  });

  return {
    ok: images.length > 0,
    images,
    missing,
    error: missing.length === 3 ? '三张图全部生成失败' : undefined,
  };
}

/** 已生成图片的本地路径（供 /sessions/:id/images/:n 提供静态文件） */
export function imagePath(sessionId: string, index: number): string | null {
  const file = path.join(imageDir(), `${sessionId}-${index}.png`);
  return fs.existsSync(file) ? file : null;
}
