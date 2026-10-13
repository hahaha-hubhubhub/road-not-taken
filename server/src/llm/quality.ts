import type { Story } from './schema.js';

/** 可判定的最低质量门槛；语义/情感是否贴合仍需真实模型评测。 */
export function checkStoryQuality(input: string, story: Story): string[] {
  const errors: string[] = [];
  const anchors = story.anchors ?? [];
  const text = [...story.scenes.map(s => `${s.caption} ${s.detail ?? ''}`), story.letter ?? ''].join('\n');
  if (!story.letter) errors.push('缺少平行时间线来信');
  else if (story.letter.length < 100) errors.push('来信过短，请回扣具体情节并承认用户在意的东西');
  if (!anchors.length) errors.push('缺少来自输入的具体锚点');
  for (const anchor of anchors) {
    if (!input.includes(anchor)) errors.push(`锚点 ${JSON.stringify(anchor)} 必须逐字来自用户原文，请改选原文里的具体词`);
    if (!text.includes(anchor)) errors.push(`锚点 ${JSON.stringify(anchor)} 未在实际正文或信中兑现，请将这个词逐字自然写入相关幕的 detail 或 letter；同义改写不通过校验`);
    if (/^(如果|当时|自己|那个|现在|后来|人生)$/.test(anchor)) errors.push('锚点过于空泛，请选具体行动、愿望或事物');
  }
  if (story.scenes.some(s => !s.heading)) errors.push('缺少取自具体对白或动作的幕标题');
  if (story.scenes.some(s => !s.detail || s.detail.length < 70)) errors.push('三幕过短，请补充具体行动和因果细节');
  const normalized = story.scenes.map(s => (s.detail ?? s.caption).replace(/[\s，。！？、]/g, ''));
  if (new Set(normalized).size !== 3) errors.push('不同幕正文重复');
  if (/一切都是最好的安排|另一条路也有风景，也要交房租/.test(story.ending)) errors.push('结尾套用通用格言，请回扣本次情节');
  return [...new Set(errors)];
}
