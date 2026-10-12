/* 没走的路 / Road Not Taken — 手机端逻辑（无依赖，纯静态可托管） */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad2 = (n) => String(n).padStart(2, '0');
  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CN_NUM = ['一', '二', '三'];

  /* ---------------- API 基地址 ---------------- */
  function resolveApiBase() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get('api');
    if (fromUrl) {
      const base = fromUrl.replace(/\/+$/, '');
      try { localStorage.setItem('rnt.apiBase', base); } catch (_) {}
      return base;
    }
    try { return localStorage.getItem('rnt.apiBase') || location.origin; } catch (_) { return location.origin; }
  }

  const safeGet = (key) => {
    try { return localStorage.getItem(key) || ''; } catch (_) { return ''; }
  };
  const safeSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch (_) {}
  };

  const state = {
    apiBase: resolveApiBase(),
    apiKey: safeGet('rnt.apiKey') || '',
    model: safeGet('rnt.model') || '',
    sessionId: null,
    poll: null,
    online: false,
    deviceConnected: false,
    demoCases: [],
    result: null,
    lastState: null,
    printingTimer: null,
    hasServerKey: false,
    mockLlm: false,
    serverModel: '',
    imageCatchUp: null,
  };

  /* ---------------- 内置演示案例（无后端时也能看） ---------------- */
  const EMBEDDED_CASES = [
    {
      id: 'dali', label: '辞职去大理开咖啡店', input: '如果我辞职去大理开咖啡店',
      title: '另一条路：大理',
      acts: [
        { caption: '你在洱海边有了一扇总能照进晨光的窗，朋友们说你终于活成了自己。' },
        { caption: '旺季时每天站十二小时，淡季用同一袋豆子解释三种风味；房东第三次涨租那天，窗外的云依然很好看。' },
        { caption: '两年后店里评分最高的商品不是咖啡，是你为补贴房租顺手做的 Excel 经营模板。' },
      ],
      ending: '另一条路也有风景，也要交房租。',
    },
    {
      id: 'beijing', label: '毕业后留在北京', input: '如果我毕业后留在北京',
      title: '另一条路：北京',
      acts: [
        { caption: '你在地铁尽头租下一间朝北的屋子，睡前刷到的全是行业峰会和深夜食堂。' },
        { caption: '通勤两小时，加班到十一点，周末用来补觉；你学会了在三平米的厨房里同时煮面和回工作消息。' },
        { caption: '第五年你终于搬进了南向的房子，也终于发现，你只是想被看见。' },
      ],
      ending: '你留下来了，也把自己留在了那里。',
    },
    {
      id: 'art', label: '学美术而不是计算机', input: '如果我学的是美术而不是计算机',
      title: '另一条路：美院',
      acts: [
        { caption: '你在画室里待到熄灯，松节油的味道盖过了宿舍的泡面味，老师说你有天赋。' },
        { caption: '为了买颜料去画室代课，为了交作业通宵；母亲的电话从"稳定一点"变成"你吃饭了吗"。' },
        { caption: '十年后你给一款 App 画图标，甲方说"再鲜艳一点"，你改了十七版。' },
      ],
      ending: '热爱没有贬值，账单也没有。',
    },
    {
      id: 'stay', label: '当时没有和他分手', input: '如果我当时没有和他分手',
      title: '另一条路：留下',
      acts: [
        { caption: '你们养了一只猫，周末去宜家买了一块谁都说好看的茶几。' },
        { caption: '争吵从谁洗碗开始，到"你从来不改"结束；和解的方式是点两份外卖，然后一起看完一档无聊综艺。' },
        { caption: '第三年你们婚礼请了十二桌，你致辞时说"谢谢你忍我"，全场都笑了。' },
      ],
      ending: '留下不是胜利，只是另一种日常。',
    },
  ];

  /* ---------------- 网络 ---------------- */
  /** 统一拼上 /api 前缀（apiBase 是 origin，如 http://host:8787） */
  function apiUrl(path) {
    const p = path.startsWith('/api') ? path : `/api${path}`;
    return state.apiBase + p;
  }

  async function api(path, options = {}) {
    let res;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeout ?? 20000);
      res = await fetch(apiUrl(path), {
        method: options.method || 'GET',
        headers: {
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          ...(state.apiKey ? { 'X-Stepfun-Api-Key': state.apiKey } : {}),
          ...(state.model ? { 'X-Stepfun-Model': state.model } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      const e = new Error(err && err.name === 'AbortError' ? '请求超时' : '无法连接到本地服务');
      e.offline = true;
      throw e;
    }
    const text = await res.text();
    // 静态托管的未知路径可能返回 200 + HTML（SPA 回退），必须识别为非后端
    const contentType = res.headers.get('content-type') || '';
    document.body.dataset.lastApi = `${path} | ${res.status} | ${contentType.slice(0, 40)}`;
    if (!contentType.includes('json')) {
      const e = new Error('后端未返回 JSON');
      e.offline = true;
      throw e;
    }
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
    return data;
  }

  /* ---------------- 视图切换 ---------------- */
  const VIEWS = ['input', 'generating', 'waiting', 'printing', 'encapsulating', 'result'];
  function showView(name) {
    // 离开结果视图时停掉补图轮询；离开等待视图时停掉传感器监听，
    // 否则手势和轮询都会跨 session 串味。
    if (name !== 'result') clearInterval(state.imageCatchUp);
    if (name !== 'waiting' && flip) teardownFlip();
    VIEWS.forEach((v) => $(`view-${v}`).classList.toggle('hidden', v !== name));
    window.scrollTo(0, 0);
  }

  function showInputError(msg) { const el = $('input-error'); el.textContent = msg; el.classList.remove('hidden'); }
  function hideInputError() { $('input-error').classList.add('hidden'); }

  function updateDeviceBadge() {
    $('device-badge').classList.toggle('hidden', !state.deviceConnected);
  }

  /** 右上角状态：已就绪 / 未设置 Key / 未连接 */
  function updateStatus() {
    const el = $('btn-status');
    if (!state.online) {
      el.textContent = '未连接服务';
      el.className = 'status warn';
      return;
    }
    const hasKey = Boolean(state.apiKey) || state.hasServerKey;
    if (state.mockLlm) {
      el.textContent = '演示模式';
      el.className = 'status';
      return;
    }
    if (!hasKey) {
      el.textContent = '未设置 Key';
      el.className = 'status warn';
      return;
    }
    el.textContent = `已就绪 · ${state.model || state.serverModel || '默认模型'}`;
    el.className = 'status ok';
  }

  function enterOffline(reason) {
    state.online = false;
    state.deviceConnected = false;
    updateDeviceBadge();
    $('offline-banner').classList.remove('hidden');
    state.demoCases = EMBEDDED_CASES;
    renderChips();
    updateStatus();
    if (reason) document.body.dataset.offlineReason = String(reason).slice(0, 200);
  }

  /* ---------------- 启动探测 ---------------- */
  let probePromise = null;

  function ensureProbe() {
    if (!probePromise) probePromise = probe();
    return probePromise;
  }

  async function probe() {
    try {
      const health = await api('/health', { timeout: 4000 });
      if (!health || health.ok !== true) throw new Error('健康检查异常');
      state.online = true;
      state.hasServerKey = Boolean(health.hasServerKey);
      state.mockLlm = Boolean(health.mockLlm);
      state.serverModel = health.model || '';
      $('offline-banner').classList.add('hidden');
      try {
        const status = await api('/device/status', { timeout: 4000 });
        state.deviceConnected = Boolean(status.connected);
      } catch (_) {}
      updateDeviceBadge();
      try {
        const demo = await api('/demo/cases', { timeout: 5000 });
        if (Array.isArray(demo.cases) && demo.cases.length) state.demoCases = demo.cases;
      } catch (_) { state.demoCases = EMBEDDED_CASES; }
      if (!state.demoCases.length) state.demoCases = EMBEDDED_CASES;
    } catch (err) {
      enterOffline(err && err.message ? err.message : 'probe failed');
    }
    updateStatus();
    renderChips();

    // 首次进入且没有任何 Key 时，自动弹出设置面板（只提示一次）
    if (state.online && !state.mockLlm && !state.apiKey && !state.hasServerKey && !safeGet('rnt.settingsSeen')) {
      safeSet('rnt.settingsSeen', '1');
      setTimeout(openSettings, 500);
    }
  }

  /* ---------------- 设置弹窗 ---------------- */
  function openSettings() {
    $('input-key').value = state.apiKey;
    $('input-api').value = state.apiBase;
    $('select-model').value = state.model || state.serverModel || 'step-5-preview';
    $('settings-modal').classList.remove('hidden');
  }

  function closeSettings() {
    $('settings-modal').classList.add('hidden');
  }

  function saveSettings() {
    state.apiKey = $('input-key').value.trim();
    state.model = $('select-model').value;
    const base = $('input-api').value.trim().replace(/\/+$/, '');
    safeSet('rnt.apiKey', state.apiKey);
    safeSet('rnt.model', state.model);
    if (base && base !== state.apiBase) {
      safeSet('rnt.apiBase', base);
      state.apiBase = base;
    }
    closeSettings();
    updateStatus();
    void probe();
  }

  function renderChips() {
    const wrap = $('demo-chips');
    wrap.innerHTML = '';
    for (const c of state.demoCases) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = c.label;
      btn.addEventListener('click', () => {
        $('input-text').value = c.input;
        $('char-count').textContent = `${c.input.length} / 100`;
        start(c.input);
      });
      wrap.appendChild(btn);
    }
  }

  /* ---------------- 主流程 ---------------- */
  const GENERATING_TEXTS = [
    '正在拆掉那条路上的滤镜……',
    '正在计算旺季的房租……',
    '正在预约一份冷掉的外卖……',
    '正在等一趟凌晨的末班车……',
  ];
  let generatingTimer = null;

  function startGeneratingTexts() {
    let i = 0;
    const t0 = Date.now();
    $('generating-text').textContent = GENERATING_TEXTS[0];
    clearInterval(generatingTimer);
    generatingTimer = setInterval(() => {
      i = (i + 1) % GENERATING_TEXTS.length;
      $('generating-text').textContent = GENERATING_TEXTS[i];
      const sec = Math.round((Date.now() - t0) / 1000);
      $('generating-sub').textContent = `正在调用 step-5-preview 生成三幕故事…已等待 ${sec} 秒`;
    }, 1000);
  }

  function stopPoll() { clearInterval(state.poll); state.poll = null; }

  async function start(rawText) {
    const text = (rawText || '').trim();
    const isCrisis = /自杀|自残|自伤|轻生|不想活|活不下去|想死|割腕|跳楼|kill myself|suicide|self[-\s]?harm/i.test(text);
    if (!isCrisis && text.length < 10) return showInputError('再多写一点：至少 10 个字，比如"如果当时我留在了北京"');
    if (text.length > 100) return showInputError('太长了，请精简到 100 字以内');
    hideInputError();

    if (!state.online) {
      if (isCrisis) return showInputError('当前未连接服务，不能安全处理这段内容；请联系信任的人或当地专业援助。');
      return showDemoResult(pickEmbedded(text));
    }

    state.sessionId = null;
    state.lastState = null;
    showView('generating');
    startGeneratingTexts();
    try {
      const session = await api('/sessions', { method: 'POST', body: {} });
      state.sessionId = session.sessionId;
      await api(`/sessions/${session.sessionId}/generate`, { method: 'POST', body: { text }, timeout: 30000 });
      pollSession();
    } catch (err) {
      clearInterval(generatingTimer);
      if (err.offline) {
        enterOffline();
        if (isCrisis) {
          showInputError('连接中断，无法安全处理这段内容；请联系信任的人或当地专业援助。');
          showView('input');
          return;
        }
        return showDemoResult(pickEmbedded(text));
      }
      showInputError(err.message);
      showView('input');
      if (/API Key/i.test(err.message || '')) openSettings();
    }
  }

  function pollSession() {
    stopPoll();
    state.poll = setInterval(async () => {
      if (!state.sessionId) return stopPoll();
      try {
        const s = await api(`/sessions/${state.sessionId}`, { timeout: 10000 });
        state.deviceConnected = Boolean(s.deviceConnected);
        updateDeviceBadge();

        if (s.state === 'await_action' && state.lastState !== 'await_action') {
          state.lastState = 'await_action';
          clearInterval(generatingTimer);
          showWaiting(s);
        } else if (s.state === 'await_action') {
          updateActionDots(s);
        } else if (s.state === 'printing' && state.lastState !== 'printing') {
          state.lastState = 'printing';
          showPrinting(s);
        } else if (s.state === 'encapsulating' && state.lastState !== 'encapsulating') {
          state.lastState = 'encapsulating';
          clearTimeout(state.printingTimer);
          showView('encapsulating');
        } else if (s.state === 'done' && state.lastState !== 'done') {
          state.lastState = 'done';
          stopPoll();
          state.result = s;
          renderResult(s);
          showView('result');
          // 生图是后台并行的，done 时可能还没跑完；补一个短轮询把图换上
          if (s.imageStatus !== 'ready' && s.kind !== 'care') startImageCatchUp();
        } else if (s.state === 'error' && state.lastState !== 'error') {
          state.lastState = 'error';
          stopPoll();
          clearInterval(generatingTimer);
          showInputError(s.error || '生成失败，请重试');
          showView('input');
          // 没填 Key 时自动弹出设置，省得用户自己找
          if (/API Key/i.test(s.error || '')) openSettings();
        }
      } catch (err) {
        if (err.offline) {
          stopPoll();
          clearInterval(generatingTimer);
          enterOffline();
        }
      }
    }, 1200);
  }

  /* ---------------- 翻转手势（手机即设备，HW-03） ---------------- */

  let flip = null;          // 当前 session 的检测器
  let flipDone = 0;         // 本地已完成的格数（服务端只在全部完成后才更新）

  function teardownFlip() {
    if (flip) { flip.stop(); flip = null; }
    flipDone = 0;
    $('flip-meter').classList.add('hidden');
    $('flip-meter').classList.remove('warn');
    $('btn-flip-start').classList.add('hidden');
  }

  /**
   * 进入等待态时装配检测器。
   * 有实体设备在线时不需要手机传感器（真机自己上报动作），否则提供翻转入口；
   * 传感器不可用（非安全上下文 / 无 DeviceOrientationEvent）时回落到按钮。
   */
  function setupFlip(s) {
    teardownFlip();
    const startBtn = $('btn-flip-start');
    const meter = $('flip-meter');

    if (s.deviceConnected || !s.action || !s.action.total) {
      startBtn.classList.add('hidden');
      return;
    }
    if (!RNTFlip.canUseFlip()) {
      // 非安全上下文（如 http + 局域网 IP）下浏览器会静默拦截传感器事件
      startBtn.classList.add('hidden');
      $('waiting-hint').textContent =
        '当前连接方式不让浏览器读取传感器。改用下方按钮完成动作，或用 USB 连接后访问 localhost。';
      return;
    }

    startBtn.classList.remove('hidden');
    startBtn.disabled = false;
    startBtn.textContent = '准备好了，拿起手机';
    meter.classList.remove('hidden');

    startBtn.onclick = async () => {
      startBtn.disabled = true;
      const ok = await flip.start();
      if (!ok) {
        startBtn.textContent = '传感器权限被拒绝，请用按钮';
        meter.classList.add('hidden');
        return;
      }
      startBtn.classList.add('hidden');
      $('waiting-hint').textContent = '按提示左右翻转手机；每完成一段，进度点亮一格。';
    };

    flip = RNTFlip.createFlipDetector(s.action.moves);

    flip.onProgress((done, total, move) => {
      flipDone = done;
      paintFlipProgress(done, total, move);
    });

    flip.onWrong((actual, expected, done) => {
      const meterEl = $('flip-meter');
      meterEl.classList.add('warn');
      $('action-text').textContent = `反了，这次要${expected === 'L' ? '向左' : '向右'}翻`;
      setTimeout(() => {
        meterEl.classList.remove('warn');
        $('action-text').textContent = flipText(done, flipMovesCache.length);
      }, 900);
    });

    flip.onTilt((gamma) => {
      // 倾角映射到指示条：±90° 对应半宽
      const pct = Math.min(50, Math.abs(gamma) / 90 * 50);
      const fill = $('flip-meter-fill');
      if (gamma < 0) {
        fill.style.left = `${50 - pct}%`;
      } else {
        fill.style.left = '50%';
      }
      fill.style.width = `${pct}%`;
    });

    flip.onComplete(async () => {
      // 手机完成全部动作 → 走与服务端真机同一条完成入口
      await completeFlipAndContinue();
    });
  }

  function flipText(done, total) {
    const next = flipMovesCache[done];
    if (!next) return '翻转完成';
    const dir = next === 'L' ? '向左' : '向右';
    return `${dir}翻（第 ${done + 1} / ${total} 步）`;
  }

  function paintFlipProgress(done, total, move) {
    const dots = $('action-dots');
    if (dots.childElementCount !== total) {
      dots.innerHTML = '';
      for (let i = 0; i < total; i++) dots.appendChild(document.createElement('span'));
    }
    [...dots.children].forEach((el, i) => {
      el.className = i < done ? 'on' : i === done ? 'cur' : '';
    });
    $('action-text').textContent = done >= total ? '翻转完成，正在解锁…' : flipText(done, total);
    if (move && navigator.vibrate) navigator.vibrate(30);  // HW-02：震动反馈
  }

  /** 完成动作 → 调服务端 → 进入打印 */
  async function completeFlipAndContinue() {
    if (!state.sessionId) return;
    try {
      await api(`/sessions/${state.sessionId}/simulate-action`, { method: 'POST', body: {} });
      teardownFlip();
      showPrinting();
    } catch (err) {
      showInputError(err.message);
    }
  }

  let flipMovesCache = [];

  function showWaiting(s) {
    $('action-text').textContent = s.action ? s.action.text : '完成翻转动作';
    flipMovesCache = s.action ? s.action.moves.slice() : [];
    updateActionDots(s);
    const simulate = $('btn-simulate');
    const hint = $('waiting-hint');
    const note = $('waiting-note');
    if (s.deviceConnected) {
      simulate.classList.add('hidden');
      hint.textContent = s.delivery === 'capsule'
        ? '完成翻转后打印文字纸带，再由设备卷入展示胶囊。请勿伸手进入出仓口。'
        : '完成翻转后打印三幕小票；这台设备暂不支持胶囊封装。';
    } else {
      simulate.classList.remove('hidden');
      hint.textContent = '现场暂未连接实体设备。点击按钮模拟打印与胶囊封装；不会得到实物。';
    }
    note.textContent = s.degraded ? '模型超时或未连接，本次使用预生成演示案例。' : '';
    showView('waiting');
    setupFlip(s);   // 装配手机传感器检测
  }

  function updateActionDots(s) {
    // 手机传感器驱动时，本地进度比服务端更细：服务端只有全部完成才更新 action.done，
    // 而轮询有 1.2s 延迟，用服务端值会把已经翻完的格子弹回未完成状态。
    const total = s.action ? s.action.total : 0;
    const serverDone = s.action ? s.action.done : 0;
    const done = Math.max(serverDone, flipDone);
    const dots = $('action-dots');
    if (dots.childElementCount !== total) {
      dots.innerHTML = '';
      for (let i = 0; i < total; i++) dots.appendChild(document.createElement('span'));
    }
    [...dots.children].forEach((el, i) => {
      el.className = i < done ? 'on' : i === done ? 'cur' : '';
    });
  }

  function showPrinting(s) {
    showView('printing');
    $('printing-sub').textContent = s?.delivery === 'receipt'
      ? '当前设备只打印完整小票，不进行胶囊封装。'
      : '先打印三幕纸带，完成后才开始封装。';
    $('printing-text').textContent = '正在打印三幕故事……';
    clearTimeout(state.printingTimer);
    state.printingTimer = setTimeout(() => {
      $('printing-text').textContent = '纸带正在送出，完成后才开始封装……';
    }, 2200);
  }

  /* ---------------- 结果渲染 ---------------- */
  const relImg = (url) => String(url || '').replace(/^\//, '');

  /**
   * 补图轮询：done 时生图可能还在跑（三张并行约 34s，用户翻转只要几秒）。
   * 每 2.5s 查一次，拿到就绪或超过 60s 就停，避免无谓请求。
   */
  function startImageCatchUp() {
    clearInterval(state.imageCatchUp);
    let elapsed = 0;
    state.imageCatchUp = setInterval(async () => {
      elapsed += 2500;
      if (!state.sessionId || elapsed > 60000) {
        clearInterval(state.imageCatchUp);
        return;
      }
      try {
        const s = await api(`/sessions/${state.sessionId}`, { timeout: 8000 });
        state.result = s;
        if (s.imageStatus === 'ready') {
          clearInterval(state.imageCatchUp);
          renderResult(s);   // 用生成图重绘
        }
      } catch (_) {
        clearInterval(state.imageCatchUp);
      }
    }, 2500);
  }

  function renderResult(s) {
    const note = $('delivery-note');
    note.textContent = s.kind === 'care' ? '这一次先不讲笑话，也不出胶囊。请照顾好自己。'
      : s.delivery === 'capsule' ? '设备已回报胶囊出仓；展示道具，不能吞食。'
      : s.delivery === 'receipt' ? '当前设备只支持小票，尚未完成胶囊封装。'
      : '模拟体验：没有真实打印或胶囊出仓。';
    $('btn-share').classList.toggle('hidden', s.kind === 'care');
    const d = new Date(s.doneAt || s.updatedAt || Date.now());
    const meta = `RNT-${String(s.sessionId || '').slice(0, 6).toUpperCase()} · ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const acts = (s.acts || [])
      .map(
        (a) => {
          // AI-03：图片就绪的幕用生成图，其余回落预置图。onerror 兜底，
          // 避免生图刚好失败或已过期时出现破图。
          const ready = s.imageStatus === 'ready' && (s.imageReadyActs || []).includes(a.index);
          const genUrl = ready ? `${state.apiBase}/api/sessions/${s.sessionId}/images/${a.index}` : '';
          const preset = relImg(a.imageUrl);
          const src = genUrl || preset;
          const fallback = genUrl ? ` onerror="this.onerror=null;this.src='${preset.replace(/'/g, "\\'")}'"` : '';
          return `
        <div class="act">
          <div class="act-label">第${CN_NUM[a.index - 1] || a.index}幕 · ${escapeHtml(a.name)}</div>
          <img src="${escapeHtml(src)}"${fallback} alt="第${a.index}幕插画" />
          <p>${escapeHtml(a.caption)}</p>
        </div>`;
        },
      )
      .join('<div class="dashed"></div>');

    const qr = s.sessionId && s.kind !== 'care'
      ? `<div class="qr-wrap"><img id="qr-img" crossorigin="anonymous" src="${state.apiBase}/api/sessions/${s.sessionId}/qr.png" alt="二维码" /></div>
         <div class="receipt-foot">扫码查看这条没走的路</div>`
      : s.kind === 'care' ? '<div class="receipt-foot">只在此页面展示 · 不出实体胶囊</div>'
        : '<div class="receipt-foot">演示模式 · 未连接本地服务</div>';

    $('receipt').innerHTML = `
      <div class="receipt-title">${escapeHtml(s.title || '另一条路')}${s.degraded ? '<span class="tag-degraded">演示案例</span>' : ''}</div>
      <div class="receipt-meta">${meta}</div>
      <div class="dashed"></div>
      ${acts}
      <div class="dashed"></div>
      <div class="ending">${escapeHtml(s.ending || '')}</div>
      <div class="disclaimer">${escapeHtml(s.disclaimer || '这是模型生成的虚构故事，不是人生预测。')}</div>
      ${qr}`;
  }

  function pickEmbedded(text) {
    const map = [
      [/大理|咖啡|洱海/, 'dali'],
      [/北京|毕业|留京/, 'beijing'],
      [/美术|画画|美院|艺术/, 'art'],
      [/分手|前任|男朋友|女朋友|他|她/, 'stay'],
    ];
    for (const [re, id] of map) if (re.test(text)) return EMBEDDED_CASES.find((c) => c.id === id);
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.codePointAt(0)) % 100000;
    return EMBEDDED_CASES[h % EMBEDDED_CASES.length];
  }

  function showDemoResult(caze) {
    state.result = {
      sessionId: '',
      title: caze.title,
      acts: caze.acts.map((a, i) => ({ index: i + 1, name: ['滤镜', '代价', '意外'][i], caption: a.caption, imageUrl: `img/act-${i + 1}.png` })),
      ending: caze.ending,
      disclaimer: '这是模型生成的虚构故事，不是人生预测。',
      degraded: true,
      updatedAt: Date.now(),
    };
    renderResult(state.result);
    showView('result');
  }

  /* ---------------- 保存长图 ---------------- */
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    let line = '';
    for (const ch of String(text)) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  async function saveLongImage() {
    const s = state.result;
    if (!s) return;
    const btn = $('btn-save');
    btn.disabled = true;
    btn.textContent = '正在生成…';
    try {
      const W = 750;
      const PAD = 56;
      const maxTextWidth = W - PAD * 2;
      const tmp = document.createElement('canvas');
      tmp.width = W;
      tmp.height = 2600;
      const ctx = tmp.getContext('2d');
      ctx.fillStyle = '#f7f3ea';
      ctx.fillRect(0, 0, W, 2600);
      ctx.textBaseline = 'top';
      let y = 56;

      const serif = '"Songti SC","Noto Serif SC",Georgia,serif';
      const mono = '"SF Mono",Menlo,Consolas,monospace';

      // 标题
      ctx.fillStyle = '#14110f';
      ctx.font = `700 40px ${serif}`;
      ctx.textAlign = 'center';
      for (const line of wrapLines(ctx, s.title || '另一条路', maxTextWidth)) {
        ctx.fillText(line, W / 2, y);
        y += 54;
      }
      y += 6;

      // 元信息
      const d = new Date(s.doneAt || s.updatedAt || Date.now());
      ctx.font = `20px ${mono}`;
      ctx.fillStyle = '#8a8177';
      const meta = `RNT-${String(s.sessionId || 'DEMO').slice(0, 6).toUpperCase()} · ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      ctx.fillText(meta, W / 2, y);
      y += 40;

      const dashed = () => {
        ctx.save();
        ctx.strokeStyle = '#d8d0c2';
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.beginPath();
        ctx.moveTo(PAD, y);
        ctx.lineTo(W - PAD, y);
        ctx.stroke();
        ctx.restore();
        y += 34;
      };
      dashed();

      // 三幕
      ctx.textAlign = 'left';
      const acts = s.acts || [];
      for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        ctx.font = `600 22px ${mono}`;
        ctx.fillStyle = '#c8472f';
        ctx.fillText(`第${CN_NUM[i] || i + 1}幕 · ${a.name}`, PAD, y);
        y += 40;

        const img = await loadImage(new URL(relImg(a.imageUrl), location.href).href);
        if (img) {
          const iw = maxTextWidth;
          const ih = Math.round((img.height / img.width) * iw);
          ctx.drawImage(img, PAD, y, iw, ih);
          y += ih + 18;
        }

        ctx.font = `28px ${serif}`;
        ctx.fillStyle = '#14110f';
        for (const line of wrapLines(ctx, a.caption, maxTextWidth)) {
          ctx.fillText(line, PAD, y);
          y += 44;
        }
        y += 22;
        if (i < acts.length - 1) dashed();
      }

      dashed();
      // 结尾
      ctx.textAlign = 'center';
      ctx.font = `700 34px ${serif}`;
      ctx.fillStyle = '#14110f';
      for (const line of wrapLines(ctx, s.ending || '', maxTextWidth)) {
        ctx.fillText(line, W / 2, y);
        y += 48;
      }
      y += 12;
      // 免责声明
      ctx.font = `20px ${serif}`;
      ctx.fillStyle = '#8a8177';
      for (const line of wrapLines(ctx, s.disclaimer || '', maxTextWidth)) {
        ctx.fillText(line, W / 2, y);
        y += 32;
      }
      y += 26;

      // 二维码
      if (s.sessionId) {
        const qr = await loadImage(`${state.apiBase}/api/sessions/${s.sessionId}/qr.png`);
        if (qr) {
          const size = 200;
          ctx.drawImage(qr, (W - size) / 2, y, size, size);
          y += size + 14;
          ctx.font = `18px ${mono}`;
          ctx.fillStyle = '#8a8177';
          ctx.fillText('扫码查看这条没走的路', W / 2, y);
          y += 40;
        }
      }
      y += 30;

      // 裁切到实际高度
      const out = document.createElement('canvas');
      out.width = W;
      out.height = Math.min(y, 2600);
      out.getContext('2d').drawImage(tmp, 0, 0);
      const blob = await new Promise((resolve) => out.toBlob(resolve, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `没走的路-${(s.sessionId || 'demo').slice(0, 6)}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } finally {
      btn.disabled = false;
      btn.textContent = '保存长图';
    }
  }

  /* ---------------- 分享 ---------------- */
  function copyShare() {
    const id = state.result && state.result.sessionId;
    const url = id ? `${location.origin}${location.pathname}#/r/${id}` : location.href;
    const done = () => { $('btn-share').textContent = '已复制 ✓'; setTimeout(() => ($('btn-share').textContent = '复制分享链接'), 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
    } else fallbackCopy(url, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (_) {}
    ta.remove();
  }

  /* ---------------- 路由：分享结果页 ---------------- */
  async function route() {
    const m = location.hash.match(/^#\/r\/([\w-]{4,})$/);
    if (!m) return;
    const id = m[1];
    showView('generating');
    $('generating-text').textContent = '正在取出这条没走的路……';
    try {
      const s = await api(`/sessions/${id}/result`, { timeout: 15000 });
      state.result = s;
      state.sessionId = id;
      renderResult(s);
      showView('result');
    } catch (err) {
      showInputError(err.message || '这条结果不存在或已过期（默认保留 24 小时）');
      showView('input');
    }
  }

  function restart() {
    stopPoll();
    clearInterval(generatingTimer);
    clearTimeout(state.printingTimer);
    state.sessionId = null;
    state.result = null;
    state.lastState = null;
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    $('input-text').value = '';
    $('char-count').textContent = '0 / 100';
    hideInputError();
    showView('input');
  }

  /* ---------------- 语音输入（WEB-02，P1） ---------------- */
  function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const btn = $('btn-mic');
    btn.classList.remove('hidden');
    btn.addEventListener('click', () => {
      const rec = new SR();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.maxResults = 1;
      btn.textContent = '🎤 正在听……';
      rec.onresult = (e) => {
        const text = e.results[0][0].transcript;
        $('input-text').value = text.slice(0, 100);
        $('char-count').textContent = `${$('input-text').value.length} / 100`;
      };
      rec.onerror = () => showInputError('语音识别失败，请改用键盘输入');
      rec.onend = () => { btn.textContent = '🎤 语音输入'; };
      rec.start();
    });
  }

  /* ---------------- 绑定 ---------------- */
  function bind() {
    $('input-text').addEventListener('input', (e) => {
      $('char-count').textContent = `${e.target.value.length} / 100`;
    });
    $('input-text').addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') start(e.target.value);
    });
    $('btn-generate').addEventListener('click', () => start($('input-text').value));
    $('btn-simulate').addEventListener('click', async () => {
      if (!state.sessionId) return;
      $('btn-simulate').disabled = true;
      try {
        await api(`/sessions/${state.sessionId}/simulate-action`, { method: 'POST', body: {} });
        state.lastState = 'printing';
        showPrinting({ delivery: 'demo' });
      } catch (err) {
        showInputError(err.message);
      } finally {
        $('btn-simulate').disabled = false;
      }
    });
    $('btn-save').addEventListener('click', saveLongImage);
    $('btn-share').addEventListener('click', copyShare);
    document.querySelectorAll('[data-action="restart"]').forEach((el) => el.addEventListener('click', restart));
    $('btn-connect').addEventListener('click', openSettings);
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-status').addEventListener('click', openSettings);
    $('btn-close-settings').addEventListener('click', closeSettings);
    $('btn-save-settings').addEventListener('click', saveSettings);
    $('btn-toggle-key').addEventListener('click', () => {
      const input = $('input-key');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      $('btn-toggle-key').textContent = show ? '隐藏' : '显示';
    });
    $('settings-modal').addEventListener('click', (e) => {
      if (e.target === $('settings-modal')) closeSettings();
    });
    window.addEventListener('hashchange', route);
  }

  bind();
  setupMic();
  showView('input');
  void probe();
  route();

  /* 调试/分享：?settings=1 直接打开设置面板 */
  if (new URLSearchParams(location.search).get('settings') === '1') setTimeout(openSettings, 300);

  /* 调试/演示：?autostart=如果当时我……  打开页面即自动跑一次生成 */
  const autoStart = new URLSearchParams(location.search).get('autostart');  if (autoStart) {
    const text = autoStart.slice(0, 100);
    $('input-text').value = text;
    $('char-count').textContent = `${text.length} / 100`;
    void ensureProbe().then(() => start(text));
  }
})();
