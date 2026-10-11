/**
 * 预生成演示案例（OPS-01 / MVP 验收：断网或模型超时 10 秒内切换）。
 * 现场断网、缺密钥、模型超时都会降级到这里。
 */

export interface DemoCase {
  id: string;
  /** 触发词，用于演示页快速选择 */
  label: string;
  input: string;
  title: string;
  scenes: { caption: string; image_prompt: string }[];
  ending: string;
}

export const DEMO_CASES: DemoCase[] = [
  {
    id: 'dali',
    label: '辞职去大理开咖啡店',
    input: '如果我辞职去大理开咖啡店',
    title: '另一条路：大理',
    scenes: [
      {
        caption: '你在洱海边有了一扇总能照进晨光的窗，朋友们说你终于活成了自己。',
        image_prompt: '黑白线描：女孩站在洱海边的木窗边，晨光成大块斜线，窗台一盆枯绿植',
      },
      {
        caption:
          '旺季时每天站十二小时，淡季用同一袋豆子解释三种风味；房东第三次涨租那天，窗外的云依然很好看。',
        image_prompt: '黑白线描：吧台后疲惫的男人擦杯子，墙上价目表，窗外大块云朵',
      },
      {
        caption: '两年后店里评分最高的商品不是咖啡，是你为补贴房租顺手做的 Excel 经营模板。',
        image_prompt: '黑白线描：笔记本电脑特写，屏幕上是电子表格，旁边一杯冷掉的咖啡',
      },
    ],
    ending: '另一条路也有风景，也要交房租。',
  },
  {
    id: 'beijing',
    label: '毕业后留在北京',
    input: '如果我毕业后留在北京',
    title: '另一条路：北京',
    scenes: [
      {
        caption: '你在地铁尽头租下一间朝北的屋子，睡前刷到的全是行业峰会和深夜食堂。',
        image_prompt: '黑白线描：深夜地铁车厢，一个女孩靠着车门睡着，手机亮着',
      },
      {
        caption:
          '通勤两小时，加班到十一点，周末用来补觉；你学会了在三平米的厨房里同时煮面和回工作消息。',
        image_prompt: '黑白线描：狭小厨房，电磁炉上煮着面，旁边笔记本电脑亮着',
      },
      {
        caption: '第五年你终于搬进了南向的房子，也终于发现，你只是想被看见。',
        image_prompt: '黑白线描：一扇朝南的窗户，阳光成大块白色，窗台空无一人',
      },
    ],
    ending: '你留下来了，也把自己留在了那里。',
  },
  {
    id: 'art',
    label: '学美术而不是计算机',
    input: '如果我学的是美术而不是计算机',
    title: '另一条路：美院',
    scenes: [
      {
        caption: '你在画室里待到熄灯，松节油的味道盖过了宿舍的泡面味，老师说你有天赋。',
        image_prompt: '黑白线描：画室里的画架与素描石膏像，一盏斜打的灯',
      },
      {
        caption:
          '为了买颜料去画室代课，为了交作业通宵；母亲的电话从"稳定一点"变成"你吃饭了吗"。',
        image_prompt: '黑白线描：堆叠的画框与颜料管，窗台一部老式按键手机',
      },
      {
        caption: '十年后你给一款App画图标，甲方说"再鲜艳一点"，你改了十七版。',
        image_prompt: '黑白线描：电脑屏幕上的图标草稿，旁边一沓揉皱的纸',
      },
    ],
    ending: '热爱没有贬值，账单也没有。',
  },
  {
    id: 'stay',
    label: '当时没有和他分手',
    input: '如果我当时没有和他分手',
    title: '另一条路：留下',
    scenes: [
      {
        caption: '你们养了一只猫，周末去宜家买了一块谁都说好看的茶几。',
        image_prompt: '黑白线描：沙发上的一只猫和一块空茶几，阳光斜照',
      },
      {
        caption:
          '争吵从谁洗碗开始，到"你从来不改"结束；和解的方式是点两份外卖，然后一起看完一档无聊综艺。',
        image_prompt: '黑白线描：茶几上两份外卖盒，电视亮着，两个人背对背',
      },
      {
        caption: '第三年你们婚礼请了十二桌，你致辞时说"谢谢你忍我"，全场都笑了。',
        image_prompt: '黑白线描：婚礼舞台上一对新人，台下圆桌与酒杯',
      },
    ],
    ending: '留下不是胜利，只是另一种日常。',
  },
];

/** 根据输入稳定挑选一个演示案例（同一输入总是同一案例） */
export function pickDemoCase(input: string): DemoCase {
  let h = 0;
  for (const ch of input) h = (h * 31 + ch.codePointAt(0)!) % 100000;
  return DEMO_CASES[h % DEMO_CASES.length]!;
}
