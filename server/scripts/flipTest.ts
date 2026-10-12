/**
 * 翻转检测器逻辑测试（Node，不需要浏览器或手机）。
 *
 * 用最小 DOM/W window 桩加载 web/flip.js，然后直接喂 deviceorientation 事件，
 * 验证：方向匹配计数、方向错误不计数、回中后才重新武装、全部完成才触发 onComplete。
 *
 *   npx tsx scripts/flipTest.ts        （server 目录）
 *   或 node --experimental-strip-types scripts/flipTest.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const flipSrc = fs.readFileSync(path.resolve(here, '../../web/flip.js'), 'utf8');

/* ---- 最小浏览器桩 ----
 * 注意：flip.js 通过 new Function 在全局作用域执行，函数体里引用不到模块内的
 * const listeners（闭包捕获不到），所以监听器必须存在桩对象自身上，
 * 不能依赖模块级变量。 */
const makeWindow = () => {
  const handlers: Record<string, Function[]> = {};
  return {
    isSecureContext: true,
    DeviceOrientationEvent: function () {},
    handlers,
    addEventListener(type: string, fn: Function) {
      (handlers[type] ||= []).push(fn);
    },
    removeEventListener(type: string, fn: Function) {
      handlers[type] = (handlers[type] || []).filter((f) => f !== fn);
    },
  };
};
// flip.js 末尾是 (function(global){...})(window)
const load = new Function('window', `${flipSrc}\nreturn window.RNTFlip;`);
const sandboxWindow = makeWindow();
const RNTFlip = load(sandboxWindow);

// 派发时拷贝一份：检测器在 onComplete 里会 removeEventListener 把自己摘掉，
// 直接 forEach 原数组会在遍历中跳过后续监听器。
// advanceMs 用于把 Date.now 往前推——同步 fire 之间真实耗时远小于
// MIN_FLIP_MS(320ms)，不推进时钟会被当误触发拦截，而真实翻转不可能那么快。
let clockOffset = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockOffset;

const fire = (gamma: number, advanceMs = 0): void => {
  if (advanceMs > 0) clockOffset += advanceMs;
  (sandboxWindow.handlers.deviceorientation || []).slice().forEach((fn) => fn({ gamma }));
};

async function main() {
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/* ---- 场景 1：L,R,R 依次正确翻转 ---- */
console.log('\n[1] 正确序列 L,R,R');
await (async () => {
  const d = RNTFlip.createFlipDetector(['L', 'R', 'R']);
  const progress: number[] = [];
  let completed = 0;
  d.onProgress((done) => progress.push(done));
  d.onComplete(() => completed++);

  check('初始 total=3', d.total === 3);
  check('初始 done=0', d.done === 0);

  // start() 才注册 deviceorientation 监听；requestPermission 在桩里不存在，
  // 会走 "安卓无需显式授权" 分支直接返回 granted。
  await d.start();
  check('start 后开始监听', d.listening === true);

  fire(-60, 400); // L
  check('左翻后 done=1', d.done === 1, `实际 ${d.done}`);
  fire(0);   // 回中
  fire(60, 400);  // R
  check('右翻后 done=2', d.done === 2, `实际 ${d.done}`);
  fire(0);
  fire(70, 400);  // R
  check('再右翻后 done=3', d.done === 3, `实际 ${d.done}`);
  check('进度回调为 [1,2,3]', JSON.stringify(progress) === '[1,2,3]', JSON.stringify(progress));
  check('全部完成触发一次 onComplete', completed === 1, `实际 ${completed}`);
  check('完成后自动停止监听', d.listening === false);
})();

/* ---- 场景 2：不回中不会重复计数 ---- */
console.log('\n[2] 持续倾斜不重复计数');
await (async () => {
  const d = RNTFlip.createFlipDetector(['L', 'L']);
  await d.start();
  fire(-60, 400);
  check('第一次左翻 done=1', d.done === 1, `实际 ${d.done}`);
  fire(-70, 400);
  fire(-80, 400);
  fire(-90, 400);
  check('连续倾斜仍是 done=1（未回中）', d.done === 1, `实际 ${d.done}`);
  fire(0);   // 回中
  fire(-60, 400);
  check('回中后再翻 done=2', d.done === 2, `实际 ${d.done}`);
})();

/* ---- 场景 3：方向错误不计数 ---- */
console.log('\n[3] 方向错误');
await (async () => {
  const d = RNTFlip.createFlipDetector(['L', 'R']);
  let wrongCount = 0;
  d.onWrong(() => wrongCount++);
  await d.start();
  fire(60, 400);   // 期望 L，实际 R
  check('方向错误不推进', d.done === 0, `实际 ${d.done}`);
  check('触发 onWrong', wrongCount === 1, `实际 ${wrongCount}`);
  fire(0);
  fire(-60, 400);  // 正确的 L
  check('随后正确翻转可推进', d.done === 1, `实际 ${d.done}`);
})();

/* ---- 场景 4：中立带内的抖动不触发 ---- */
console.log('\n[4] 中立带内抖动');
await (async () => {
  const d = RNTFlip.createFlipDetector(['L']);
  await d.start();
  fire(10, 400);
  fire(-15, 400);
  fire(5, 400);
  check('中立带内不动', d.done === 0, `实际 ${d.done}`);
  fire(-50, 400);
  check('超出阈值才计一次', d.done === 1, `实际 ${d.done}`);
})();

/* ---- 场景 5：canUseFlip 的安全上下文判断 ---- */
console.log('\n[5] 安全上下文门禁');
await (async () => {
  const okWin = { isSecureContext: true, DeviceOrientationEvent: function () {}, addEventListener() {}, removeEventListener() {} };
  const badWin = { isSecureContext: false, DeviceOrientationEvent: function () {}, addEventListener() {}, removeEventListener() {} };
  const noSensorWin = { isSecureContext: true, addEventListener() {}, removeEventListener() {} };

  const mk = (w: any) => new Function('window', `${flipSrc}\nreturn window.RNTFlip;`)(w);
  check('安全上下文 + 有传感器 → true', mk(okWin).canUseFlip() === true);
  check('非安全上下文 → false', mk(badWin).canUseFlip() === false);
  check('无 DeviceOrientationEvent → false', mk(noSensorWin).canUseFlip() === false);
})();

/* ---- 场景 6：finishManually（按钮兜底） ---- */
console.log('\n[6] 按钮兜底 finishManually');
await (async () => {
  const d = RNTFlip.createFlipDetector(['L', 'R']);
  let completed = 0;
  d.onComplete(() => completed++);
  d.finishManually();
  check('手动完成 done=2', d.done === 2, `实际 ${d.done}`);
  check('手动完成触发 onComplete', completed === 1);
})();

console.log(`\n结果：${pass} 通过，${fail} 失败`);
}
main();
