import { z } from 'zod';
import { CANONICAL_DISCLAIMER } from '../config.js';

/**
 * StepFun step-5-preview 的 JSON Schema 严格结构化输出（response_format.type = "json_schema"）。
 *
 * 注意：strict 模式下 API 会强制约束字段/类型/必填项，但**不代表内容业务上正确**，
 * 因此服务端仍用下面的 zod 模型做二次校验（长度、幕数、空值等）。
 *
 * 三幕顺序固定为 滤镜 → 代价 → 意外，标签由服务端渲染，模型只输出 caption / image_prompt。
 */
export const STORY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'scenes', 'ending', 'disclaimer', 'anchors', 'letter'],
  properties: {
    anchors: { type: 'array', items: { type: 'string' }, description: '1-6 个逐字来自用户输入的具体锚点，正文须兑现' },
    letter: { type: 'string', description: '120-220 字的平行时间线自我来信，口语短句、2-4 短段，回扣三幕的两个具体细节' },
    title: {
      type: 'string',
      description: '8-16 字的标题，贴合本次具体选择',
    },
    scenes: {
      type: 'array',
      description: '固定三幕：滤镜、代价、意外，按此顺序，连续人生',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['caption', 'image_prompt', 'detail', 'heading'],
        properties: {
          heading: { type: 'string', description: '2-28 字，从本幕具体对白或动作取一句，不讲大道理' },
          detail: { type: 'string', description: '手机端正文，70-140 字，最多 220 字，口语短对白与动作，有上下文与因果细节' },
          caption: {
            type: 'string',
            description: '该幕打印文案，8-60 字，关键动作和一句短对白，能看出发生了什么',
          },
          image_prompt: {
            type: 'string',
            description:
              '黑白单色、高对比、低细节的漫画画面描述，适合 58mm 热敏打印，同一次生成中人物与场景保持一致，80 字以内',
          },
        },
      },
    },
    ending: {
      type: 'string',
      description: '最后一句具体对白或动作，30 字以内，不套人生格言',
    },
    disclaimer: {
      type: 'string',
      description: '虚构声明',
    },
  },
} as const;

export const RESPONSE_FORMAT_NAME = 'road_not_taken_story';

export const SceneSchema = z.object({
  heading: z.string().trim().min(2).max(28).optional(),
  detail: z.string().trim().min(70, 'detail 太短').max(220, 'detail 太长').optional(),
  caption: z.string().min(8, 'caption 太短').max(140, 'caption 太长'),
  image_prompt: z.string().min(4, 'image_prompt 太短').max(240, 'image_prompt 太长'),
});

export const StorySchema = z.object({
  anchors: z.array(z.string().trim().min(2).max(100)).min(1).max(6).optional(),
  letter: z.string().trim().min(80, 'letter 太短').max(800, 'letter 太长').optional(),
  title: z.string().min(2, 'title 太短').max(40, 'title 太长'),
  scenes: z.array(SceneSchema).length(3, '必须正好三幕'),
  ending: z.string().min(2, 'ending 太短').max(80, 'ending 太长'),
  disclaimer: z.string().max(120).optional(),
});

export type Scene = z.infer<typeof SceneSchema>;
export type Story = z.infer<typeof StorySchema>;

/** 服务端统一规范化：免责声明以服务端为准，保证每条结果都带 */
export function normalizeStory(raw: Story): Story {
  return {
    ...(raw.anchors ? { anchors: raw.anchors } : {}),
    ...(raw.letter ? { letter: raw.letter.trim() } : {}),
    title: raw.title.trim(),
    scenes: raw.scenes.map((s) => ({
      caption: s.caption.trim(),
      ...(s.heading ? { heading: s.heading.trim() } : {}),
      ...(s.detail ? { detail: s.detail.trim() } : {}),
      image_prompt: s.image_prompt.trim(),
    })),
    ending: raw.ending.trim(),
    disclaimer: CANONICAL_DISCLAIMER,
  };
}
