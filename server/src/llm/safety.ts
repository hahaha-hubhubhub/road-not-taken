/**
 * 输入 / 输出安全过滤（PRD AI-04、7.2 内容边界）。
 *
 * 两层防护：
 * 1. 输入前置关键词 + 长度检查，命中直接走"安抚"分支，不生成黑色幽默；
 * 2. 输出后置检查，命中视为生成失败，触发重试或降级。
 */

export type SafetyVerdict =
  | { safe: true }
  | { safe: false; reason: 'too_short' | 'crisis' | 'forbidden'; advice?: string };

/** 心理危机 / 自伤：不继续生成黑色幽默，改为安抚文案 */
const CRISIS_PATTERNS = [
  /自杀|自尽|自残|自伤|轻生|不想活|活不下去|想死|死了算了|割腕|跳楼|安眠药|解脱了/,
  /kill myself|suicide|self[-\s]?harm/i,
];

/** 违法 / 色情 / 暴力：直接拒绝生成 */
const FORBIDDEN_PATTERNS = [
  /毒品|制毒|贩毒|吸毒|冰毒|大麻/,
  /强奸|迷奸|猥亵|幼女|嫖娼|卖淫/,
  /制造炸弹|炸药|枪支|买枪|洗钱|诈骗教程/,
  /色情|做爱|裸照/,
];

export function checkInput(text: string): SafetyVerdict {
  const t = text.trim();
  // 危机路由必须先于普通长度校验；“想死”也应看到安抚，而非“请多写一点”。
  if (CRISIS_PATTERNS.some((re) => re.test(t))) {
    return { safe: false, reason: 'crisis' };
  }
  if (t.length < 10) {
    return { safe: false, reason: 'too_short', advice: '请多写一点，至少 10 个字' };
  }
  if (t.length > 100) {
    return { safe: false, reason: 'too_short', advice: '请精简到 100 字以内' };
  }
  if (FORBIDDEN_PATTERNS.some((re) => re.test(t))) {
    return { safe: false, reason: 'forbidden' };
  }
  return { safe: true };
}

/** 输出兜底：不允许把死亡/重病/残疾/贫困当笑点 */
const OUTPUT_FORBIDDEN = [
  /自杀成功了|终于自杀了|死得很好|死得其所/,
  /得了癌症|确诊绝症|瘫痪|残疾.{0,6}(笑|好)|穷死|饿死/,
];

export function checkStoryText(text: string): boolean {
  return !OUTPUT_FORBIDDEN.some((re) => re.test(text));
}

/** 心理危机输入时的固定安抚结果（不生成黑色幽默） */
export const CARE_RESPONSE = {
  title: '今天先不走这条路',
  scenes: [
    {
      caption: '有些"如果"背后压着的是真实的重量，不只是遗憾。',
      image_prompt: '黑白线描：一盏亮着的台灯和一杯热水，桌角一张折起来的纸条',
    },
    {
      caption: '这一条我们不讲代价，也不讲意外——它值得被认真对待，而不是被写成段子。',
      image_prompt: '黑白线描：两把面对面的空椅子，中间一张小圆桌',
    },
    {
      caption: '如果你愿意，可以联系信任的人或当地心理援助热线；若有即刻危险，请联系当地急救服务。',
      image_prompt: '黑白线描：一部老式电话机，听筒放在一旁，听筒线绕成心形',
    },
  ],
  ending: '先照顾好现在这个人。',
  disclaimer: '这是模型生成的虚构故事，不是人生预测。',
};
