/**
 * 翻转手势识别（手机即设备，HW-03）。
 *
 * 以普通 script 引入并挂到 window.RNTFlip，与 web/ 其他文件一样零构建、无依赖。
 *
 * 用法：
 *   const flip = RNTFlip.createFlipDetector(moves);   // moves: ['L','R',...]
 *   flip.onProgress((done, total, move) => {});  // 每完成一格
 *   flip.onComplete(() => {});                    // 全部完成
 *   const ok = await flip.start();                // 需用户手势触发（iOS 授权要求）
 *   flip.stop();
 *
 * 方向判定用 deviceorientation 的 gamma（左右倾角）而不是 devicemotion：
 * gamma 只反映静态姿态，不受手抖和运动加速度干扰，误触发率低得多。
 * 判定逻辑是一个带回中的状态机——必须回到接近水平才会重新武装，
 * 否则一次大幅倾斜会被重复计数。
 *
 * 权限：iOS 13+ 要求 DeviceOrientationEvent.requestPermission() 且必须由用户手势调用；
 * 安卓 Chrome 在安全上下文（https 或 localhost）下直接可用，非安全上下文会静默失败，
 * 所以调用前要先 canUse() 判断，失败则回落到按钮。
 */

(function (global) {
  'use strict';

  const TILT_THRESHOLD = 45;   // 超过这个倾角算一次翻转（度）
  const NEUTRAL_BAND = 20;     // 回到这个范围内才算中立、重新武装
  const MIN_FLIP_MS = 320;     // 两次翻转的最小间隔，防止一次挥动计多次

  /** 是否具备传感器与安全上下文条件 */
  function canUseFlip() {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return false;
    // 安全上下文判断：http + 局域网 IP 下浏览器会拦截传感器事件
    if (window.isSecureContext === false) return false;
    return true;
  }

  /** iOS 需要显式请求权限；返回 'granted' | 'denied' | 'unsupported' */
  async function requestFlipPermission() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return 'unsupported';
    if (typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission();
        return res === 'granted' ? 'granted' : 'denied';
      } catch (_) {
        return 'denied';
      }
    }
    return 'granted'; // 安卓等无需显式授权
  }

  /**
   * 创建一个翻转检测器。
   * @param {('L'|'R')[]} moves 期待的动作序列，来自服务端 session.action.moves
   */
  function createFlipDetector(moves, initialDone = 0) {
    const seq = Array.isArray(moves) ? moves.slice() : [];
    let done = Math.max(0, Math.min(seq.length, initialDone));
    let armed = true;
    let lastFlipAt = 0;
    let listening = false;

    const onProgress = [];
    const onComplete = [];
    const onWrong = [];
    const onTilt = [];

    const emit = (arr, ...args) => arr.forEach((fn) => { try { fn(...args); } catch (_) {} });

    function handleOrientation(e) {
      if (e.gamma === null || e.gamma === undefined) return;
      const gamma = e.gamma; // 左右倾角：负=左倾，正=右倾
      emit(onTilt, gamma);

      // 回中：回到中立带内才重新武装，避免一次挥动被计成多次
      if (Math.abs(gamma) < NEUTRAL_BAND) {
        armed = true;
        return;
      }
      if (!armed) return;

      const now = Date.now();
      if (now - lastFlipAt < MIN_FLIP_MS) return;

      const actual = gamma < 0 ? 'L' : 'R';
      lastFlipAt = now;
      armed = false;

      if (done >= seq.length) return;

      const expected = seq[done];
      if (actual !== expected) {
        // 方向错了：不计数，提示用户重来，但不打断仪式
        emit(onWrong, actual, expected, done);
        return;
      }

      done += 1;
      emit(onProgress, done, seq.length, actual);

      if (done >= seq.length) {
        stopListening();
        emit(onComplete, done);
      }
    }

    function startListening() {
      if (listening) return;
      window.addEventListener('deviceorientation', handleOrientation, true);
      listening = true;
    }

    function stopListening() {
      if (!listening) return;
      window.removeEventListener('deviceorientation', handleOrientation, true);
      listening = false;
    }

    return {
      get done() { return done; },
      get total() { return seq.length; },
      get listening() { return listening; },

      onProgress(fn) { onProgress.push(fn); return this; },
      onComplete(fn) { onComplete.push(fn); return this; },
      onWrong(fn) { onWrong.push(fn); return this; },
      onTilt(fn) { onTilt.push(fn); return this; },

      /** 请求权限并开始监听；权限被拒时返回 false，调用方应回落到按钮 */
      async start() {
        const perm = await requestFlipPermission();
        if (perm !== 'granted') return false;
        if (done < seq.length) startListening();
        return true;
      },

      stop() {
        stopListening();
        armed = true;
      },

      /** 供调试/演示：手动标记完成（无传感器时由按钮调用） */
      finishManually() {
        if (done >= seq.length) return;
        done = seq.length;
        stopListening();
        emit(onProgress, done, seq.length, null);
        emit(onComplete, done);
      },
    };
  }

  global.RNTFlip = { canUseFlip, requestFlipPermission, createFlipDetector, TILT_THRESHOLD, NEUTRAL_BAND };
})(window);
