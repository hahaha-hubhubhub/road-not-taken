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
  };

  /* ---------------- 内置演示案例（无后端时也能看） ---------------- */
  const EMBEDDED_CASES = [
    {
      id: 'dali', label: '辞职去大理开咖啡店', input: '如果我辞职去大理开咖啡店',
      title: '海边小店：本店全年无休',
      acts: [
        { caption: '洱海边一扇白墙木窗。第一杯手冲端出去，海是蓝的，客人说“这就是生活”，你连拍十七张，够发一整年。' },
        { caption: '旺季三桌客人同时预约最佳落日位；淡季房东、豆商和平台抽成开了个会，一致通过：旺季延长、淡季涨价、抽成照旧。' },
        { caption: '店里的我说：这店是我的，也是房东的、平台的、豆商的，排到最后才轮到我。' },
      ],
      ending: '海风不打卡，账单打。',
    },
    {
      id: 'beijing', label: '毕业后留在北京', input: '如果我毕业后留在北京',
      title: '留在北京：窗户朝西，时间朝甲方',
      acts: [
        { caption: '你在三环里租到一间朝北的屋子。睡前刷到的全是行业峰会、“北京凌晨四点”和别人的入职照。' },
        { caption: '地铁、日程表和外卖提醒轮流当闹钟。你刚挤上早班车，工牌就提醒你下班后还有一场对齐会。' },
        { caption: '工位上的我说：我住的地方朝北，我的窗户朝西，我的时间朝甲方。' },
      ],
      ending: '日出看到了，工位也到了。',
    },
    {
      id: 'art', label: '学美术而不是计算机', input: '如果我学的是美术而不是计算机',
      title: '画室很自由，甲方更自由',
      acts: [
        { caption: '画室熄灯前，松节油盖过泡面味。老师站你背后看了三秒，说“你有天赋”——这三个字你存了两年。' },
        { caption: '颜料刚拆封，截稿日提前四天。甲方说“再鲜艳一点”，你把同一套配色交到第八版；第九版他问你，能不能回到第七版。' },
        { caption: '画室里的我说：别问我后不后悔，我正忙着给第八版盖一层更鲜艳的灰。' },
      ],
      ending: '画室很自由，甲方更自由。',
    },
    {
      id: 'stay', label: '当时没有和他分手', input: '如果我当时没有和他分手',
      title: '没分手：先装茶几',
      acts: [
        { caption: '你们养了只猫，周末去宜家买了张谁看都说“挺温馨”的茶几，朋友圈里你们是模范情侣。' },
        { caption: '茶几说明书少画了一颗螺丝，猫负责把剩下的螺丝藏起来。三年后你们找到那颗螺丝，吵了一架，关于是谁弄丢的。' },
        { caption: '客厅里的我说：感情没散，茶几差点。我们现在最熟练的技能，是沉默着拼家具。' },
      ],
      ending: '感情没散，茶几差点。',
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
    if (name !== 'waiting') disarmGesture();
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

  /* ---------------- 运行模式说明：与齿轮设置分开 ---------------- */
  let modeReturnFocus = null;
  function openMode() {
    modeReturnFocus = document.activeElement;
    const description = !state.online
      ? '本地服务没连上。现在只能玩现成案例，不能现场生成新故事。'
      : state.mockLlm
        ? '现在是现成案例模式：故事提前写好了，不调用实时模型。'
        : (state.apiKey || state.hasServerKey)
          ? `实时 AI 在线，当前模型是 ${state.model || state.serverModel || '默认模型'}。模型要是临时掉链子，页面会明确切回现成案例。`
          : '服务连上了，但还差一个模型 Key。可以点齿轮去设置，也可以先玩现成案例。';
    $('mode-description').textContent = description;
    $('mode-device').textContent = state.deviceConnected
      ? '实体设备已连接。到底有没有打印和出仓，以传感器回报为准。'
      : '实体设备没连上。网页里的打印和出仓只是软件模拟，不会凭空掉出一颗胶囊。';
    $('mode-modal').classList.remove('hidden');
    $('btn-mode-close').focus();
  }
  function closeMode() {
    $('mode-modal').classList.add('hidden');
    modeReturnFocus?.focus();
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
    '机器正在读你那条路的广告词……',
    '正在找这条路上没人提前告诉你的那几笔账……',
    '正在问那边的你，最近过得怎么样……',
    '别催。那边的你也在加班……',
    '正在确认：那条路也没给你开后门……',
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

  function showWaiting(s) {
    $('action-text').textContent = s.action ? s.action.text : '完成翻转动作';
    resetGestures(s.action ? s.action.total : 0);
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
  }

  function updateActionDots(s) {
    const total = s.action ? s.action.total : 0;
    // 没接实体设备时，手机动作就是动作来源，本地进度不能被轮询覆盖回 0
    const local = !state.deviceConnected && ges.total === total ? ges.done : 0;
    const done = Math.max(s.action ? s.action.done : 0, local);
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
        (a) => `
        <div class="act">
          <div class="act-label">第${CN_NUM[a.index - 1] || a.index}幕 · ${escapeHtml(a.name)}</div>
          <img src="${escapeHtml(relImg(a.imageUrl))}" alt="第${a.index}幕插画" />
          <p>${escapeHtml(a.caption)}</p>
        </div>`,
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
      <div class="disclaimer">${escapeHtml(s.degraded ? '预置虚构案例，未调用实时模型；不是人生预测。' : (s.disclaimer || '这是模型生成的虚构故事，不是人生预测。'))}</div>
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
      acts: caze.acts.map((a, i) => ({ index: i + 1, name: ['看起来', '后来', '那边的我'][i], caption: a.caption, imageUrl: `img/act-${i + 1}.png` })),
      ending: caze.ending,
      disclaimer: '预置虚构案例，未调用实时模型；不是人生预测。',
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
      for (const line of wrapLines(ctx, s.degraded ? '预置虚构案例，未调用实时模型；不是人生预测。' : (s.disclaimer || ''), maxTextWidth)) {
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

  /* ---------------- 手机动作：真传感器驱动 ----------------
     规则：手机动作是「用户真的动手了」的证据，做满次数才放行。
     没有实体设备时，做满后走演示通道（服务端标记 simulated，页面照实说明）；
     接了实体设备时，手机动作不计入放行，仍以机器回报为准。 */
  const GESTURES = [
    { id: 'flip', name: '翻个面', desc: '把手机翻过去再翻回来', sensor: 'orient' },
    { id: 'shake', name: '摇一摇', desc: '用力摇三下', sensor: 'motion' },
    { id: 'press', name: '按住不放', desc: '按住读数框两秒', sensor: null },
    { id: 'tap', name: '拍一下', desc: '在手机背上拍一巴掌', sensor: 'motion' },
    { id: 'blow', name: '吹一口气', desc: '对着话筒吹一下', sensor: 'mic' },
    { id: 'still', name: '放平别动', desc: '放平，数三秒', sensor: 'motion' },
  ];
  const DEV = {
    flipDeg: 110,   // 相对基准转过的角度
    shakeG: 2.1,    // 每次摇动的加速度
    shakeHits: 3,
    shakeGap: 260,  // 两次有效摇动的最小间隔
    tapG: 3.2,      // 拍一下的瞬时峰值
    holdMs: 2000,
    stillDev: 6,    // 「别动」允许的最大角度漂移
    stillMs: 3000,
    blowLevel: 0.16,
    blowFrames: 3,
  };

  const ges = {
    active: null, done: 0, total: 0,
    base: null, hits: 0, last: 0, peak: 0, stillSince: 0, quietSince: 0,
    holdRaf: 0, holdStart: 0, micStream: null, audioCtx: null, analyser: null, buf: null, micRaf: 0,
    blowHits: 0, granted: false, nudge: null, lastRead: 0, holdDone: false,
  };

  const sensorOK = () => window.isSecureContext;
  const needsPermission = () => typeof DeviceOrientationEvent !== 'undefined'
    && typeof DeviceOrientationEvent.requestPermission === 'function';

  function renderGestures() {
    const wrap = $('phone-chips');
    if (!wrap || wrap.dataset.built === '1') {
      if (wrap) wrap.querySelectorAll('[data-gesture]').forEach((b) => { b.disabled = b.dataset.blocked === '1' || !ges.total; });
      return;
    }
    wrap.dataset.built = '1';
    wrap.innerHTML = GESTURES.map((g) => {
      const blocked = g.sensor && !sensorOK();
      return `<button class="gchip" type="button" data-gesture="${g.id}" data-blocked="${blocked ? 1 : 0}" aria-pressed="false"${blocked ? ' disabled' : ''}>`
        + `<b>${g.name}</b><span>${blocked ? '需要 HTTPS' : g.desc}</span></button>`;
    }).join('');
    wrap.querySelectorAll('[data-gesture]').forEach((btn) => {
      btn.addEventListener('click', () => { void armGesture(btn.dataset.gesture); });
    });
  }

  async function askSensors() {
    if (ges.granted) return true;
    if (!needsPermission()) { ges.granted = true; return true; }
    try {
      // 必须在用户手势里调用，所以放在第一次点动作按钮时。
      if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
        const a = await DeviceOrientationEvent.requestPermission();
        const b = typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission
          ? await DeviceMotionEvent.requestPermission() : 'granted';
        ges.granted = a === 'granted';
        return ges.granted && b === 'granted';
      }
    } catch (_) { /* 拒绝了也还能用「按住不放」和手动确认 */ }
    ges.granted = false;
    return false;
  }

  function disarmGesture() {
    ges.active = null;
    cancelAnimationFrame(ges.holdRaf);
    cancelAnimationFrame(ges.micRaf);
    ges.micRaf = 0;
    clearTimeout(ges.nudge);
    if (ges.micStream) { ges.micStream.getTracks().forEach((t) => t.stop()); ges.micStream = null; }
    if (ges.audioCtx) { try { void ges.audioCtx.close(); } catch (_) {} ges.audioCtx = null; }
    ges.analyser = null;
    const armed = $('phone-armed');
    if (armed) armed.classList.add('hidden');
    const readout = $('sensor-readout');
    if (readout) readout.classList.remove('hold-target');
    document.querySelectorAll('#phone-chips [data-gesture]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    const bar = $('phone-bar-fill');
    if (bar) bar.style.width = '0%';
  }

  async function armGesture(id) {
    const g = GESTURES.find((x) => x.id === id);
    if (!g) return;
    disarmGesture();
    if (g.sensor) {
      const ok = await askSensors();
      if (!ok) {
        note('这台手机没给传感器权限。换成「按住不放」，或者点下面的手动确认。');
        return;
      }
    }
    ges.active = id;
    ges.hits = 0; ges.peak = 0; ges.base = null; ges.stillSince = 0; ges.blowHits = 0; ges.quietSince = 0; ges.holdDone = false;
    document.querySelector(`#phone-chips [data-gesture="${id}"]`).setAttribute('aria-pressed', 'true');
    $('phone-armed').classList.remove('hidden');
    $('phone-arm-title').textContent = g.id === 'press' ? '按住下面这块框，别松手' : `${g.name}：${g.desc}`;
    $('sensor-readout').textContent = g.id === 'press' ? '按住这里不放…' : '传感器待命，动一下手机试试';
    if (g.id === 'press') $('sensor-readout').classList.add('hold-target');
    if (g.id === 'blow') void startBlow();
    note('');
    // 8 秒没反应就给一条兜底提示，别让人干等
    ges.nudge = setTimeout(() => {
      if (ges.active === id && !ges.done) note('还是没读到？确认用的是手机（不是电脑）、页面是 HTTPS；也可以点下面的手动确认。');
    }, 8000);
  }

  function hit(via) {
    if (!ges.active) return;
    ges.done += 1;
    if (navigator.vibrate) navigator.vibrate(via === 'manual' ? 18 : [14, 40, 14]);
    const card = $('phone-card');
    card.classList.remove('hit-flash');
    void card.offsetWidth;
    card.classList.add('hit-flash');
    updatePhoneCount();
    if (ges.done >= ges.total) { void finishGestureRun(); return; }
    // 还要做下一次：重置这一轮的判定
    ges.hits = 0; ges.peak = 0; ges.base = null; ges.stillSince = 0; ges.blowHits = 0;
    $('phone-arm-title').textContent = `再来一次（还差 ${ges.total - ges.done} 次）`;
    setReadout('重置好了，再来一次。');
    const bar = $('phone-bar-fill');
    if (bar) bar.style.width = '0%';
  }

  function updatePhoneCount() {
    const el = $('phone-count');
    if (el) el.textContent = `${ges.done} / ${ges.total}`;
    const log = $('action-dots');
    if (log && !state.deviceConnected) {
      // 手机动作同样要把机器那排点填掉，否则看不出「动作没到就不打」
      [...log.children].forEach((n, i) => { n.className = i < ges.done ? 'on' : i === ges.done ? 'cur' : ''; });
    }
  }

  async function finishGestureRun() {
    disarmGesture();
    updatePhoneCount();
    if (state.deviceConnected) {
      note(`手机动作已做满 ${ges.total} 次。机器已连接，真正放行以机器回报的动作为准。`);
      return;
    }
    note('动作做满，正在放行打印……');
    try {
      await api(`/sessions/${state.sessionId}/simulate-action`, { method: 'POST', body: {} });
      state.lastState = 'printing';
      showPrinting({ delivery: 'demo' });
    } catch (err) {
      note(`放行失败：${err.message}`);
    }
  }

  function note(text) {
    const el = $('phone-note');
    if (el) el.textContent = text || '';
  }

  function resetGestures(total) {
    disarmGesture();
    ges.done = 0;
    ges.total = Number(total) || 0;
    renderGestures();
    updatePhoneCount();
    const sub = $('phone-sub');
    if (sub) {
      sub.textContent = !ges.total ? '这一步没有动作要求。'
        : state.deviceConnected
          ? `机器已连接：手机动作只算热身，真正放行以机器回报为准（做满 ${ges.total} 次也不代机器签字）。`
          : `选一个动作，在手机上做满 ${ges.total} 次。做满之前，机器不会开始打印。`;
    }
    document.querySelectorAll('#phone-chips [data-gesture]').forEach((b) => { b.disabled = !ges.total; });
    note('');
  }

  /* 传感器：翻个面 / 放平别动（陀螺仪） */
  function onOrient(e) {
    if (e.beta === null || e.gamma === null) return;
    const now = Date.now();
    if (now - ges.lastRead > 90) {
      ges.lastRead = now;
      if (ges.active === 'flip' || ges.active === 'still') {
        const b = ges.base;
        const d = b ? Math.max(Math.abs(e.beta - b.beta), Math.abs(e.gamma - b.gamma)) : 0;
        const out = ges.active === 'flip'
          ? `翻转 ${Math.round(d)}° / ${DEV.flipDeg}°`
          : `漂移 ${Math.round(d)}° / 允许 ${DEV.stillDev}°`;
        setReadout(out);
        if (ges.active === 'flip') progress(d / DEV.flipDeg);
      }
    }
    if (ges.active === 'flip') {
      if (!ges.base) { ges.base = { beta: e.beta, gamma: e.gamma }; return; }
      const d = Math.max(Math.abs(e.beta - ges.base.beta), Math.abs(e.gamma - ges.base.gamma));
      if (d > DEV.flipDeg) hit('sensor');
    } else if (ges.active === 'still') {
      if (!ges.base) { ges.base = { beta: e.beta, gamma: e.gamma }; ges.stillSince = Date.now(); return; }
      const d = Math.max(Math.abs(e.beta - ges.base.beta), Math.abs(e.gamma - ges.base.gamma));
      if (d > DEV.stillDev) { ges.stillSince = Date.now(); progress(0); return; }
      const held = Date.now() - ges.stillSince;
      progress(held / DEV.stillMs);
      if (held > DEV.stillMs) hit('sensor');
    }
  }

  /* 传感器：摇一摇 / 拍一下（加速度计） */
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    const mag = Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2) / 9.81;
    const now = Date.now();
    if (now - ges.lastRead > 90) {
      ges.lastRead = now;
      if (ges.active === 'shake' || ges.active === 'tap') {
        setReadout(`${mag.toFixed(1)} g · 已捕捉 ${ges.hits} 次`);
      }
    }
    if (ges.active !== 'shake' && ges.active !== 'tap') return;
    if (ges.active === 'tap') {
      // 拍一下：要单次尖峰，前面还得安静一会儿，免得和「摇」混在一起
      if (mag < 1.35) { ges.quietSince = now; return; }
      if (now - ges.quietSince < 500) return;
      if (mag > DEV.tapG) hit('sensor');
      return;
    }
    if (mag > DEV.shakeG && now - ges.last > DEV.shakeGap) {
      ges.last = now;
      ges.hits += 1;
      progress(ges.hits / DEV.shakeHits);
      if (ges.hits >= DEV.shakeHits) hit('sensor');
    }
  }

  if (typeof DeviceOrientationEvent !== 'undefined') window.addEventListener('deviceorientation', onOrient);
  if (typeof DeviceMotionEvent !== 'undefined') window.addEventListener('devicemotion', onMotion);

  /* 按住不放 */
  function holdStart(ev) {
    if (ges.active !== 'press') return;
    ev.preventDefault();
    const el = $('sensor-readout');
    const t0 = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - t0) / DEV.holdMs);
      progress(p);
      setReadout(`按住 ${(p * DEV.holdMs / 1000).toFixed(1)} 秒 / ${(DEV.holdMs / 1000).toFixed(1)} 秒`);
      if (p < 1) ges.holdRaf = requestAnimationFrame(tick);
      else { ges.holdDone = true; el.textContent = '松手。'; hit('hold'); }
    };
    ges.holdRaf = requestAnimationFrame(tick);
  }
  function holdEnd() {
    if (ges.active !== 'press') return;
    cancelAnimationFrame(ges.holdRaf);
    if (ges.holdDone) return; // 已经按够了，松手不算失误
    setReadout('松早了。再来一次，按够两秒。');
    progress(0);
  }

  /* 吹一口气（麦克风） */
  async function startBlow() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('这台设备没有浏览器麦克风接口。');
      ges.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setReadout('拿不到麦克风权限。换成别的动作，或点下面的手动确认。');
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ges.audioCtx = new Ctx();
    const src = ges.audioCtx.createMediaStreamSource(ges.micStream);
    ges.analyser = ges.audioCtx.createAnalyser();
    ges.analyser.fftSize = 1024;
    src.connect(ges.analyser);
    ges.buf = new Float32Array(ges.analyser.fftSize);
    const loop = () => {
      if (!ges.analyser || ges.active !== 'blow') return;
      ges.analyser.getFloatTimeDomainData(ges.buf);
      let sum = 0;
      for (let i = 0; i < ges.buf.length; i++) sum += ges.buf[i] * ges.buf[i];
      const rms = Math.sqrt(sum / ges.buf.length);
      setReadout(`气流 ${(rms * 100).toFixed(0)} / 门槛 ${(DEV.blowLevel * 100).toFixed(0)}`);
      progress(rms / DEV.blowLevel);
      if (rms > DEV.blowLevel) {
        ges.blowHits += 1;
        if (ges.blowHits >= DEV.blowFrames) { hit('sensor'); return; }
      } else if (ges.blowHits > 0 && rms < DEV.blowLevel * 0.6) {
        ges.blowHits = 0;
      }
      ges.micRaf = requestAnimationFrame(loop);
    };
    loop();
  }

  function setReadout(text) {
    const el = $('sensor-readout');
    if (el) el.textContent = text;
  }
  function progress(ratio) {
    const bar = $('phone-bar-fill');
    if (bar) bar.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
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
        if (ges.total) { ges.done = ges.total; updatePhoneCount(); }
        await api(`/sessions/${state.sessionId}/simulate-action`, { method: 'POST', body: {} });
        state.lastState = 'printing';
        showPrinting({ delivery: 'demo' });
      } catch (err) {
        showInputError(err.message);
      } finally {
        $('btn-simulate').disabled = false;
      }
    });
    $('phone-cancel').addEventListener('click', () => { disarmGesture(); note('换一个动作。'); });
    $('phone-cancel').addEventListener('pointerdown', (e) => e.stopPropagation());
    const holdEl = $('sensor-readout');
    holdEl.addEventListener('pointerdown', holdStart);
    holdEl.addEventListener('pointerup', holdEnd);
    holdEl.addEventListener('pointercancel', holdEnd);
    holdEl.addEventListener('pointerleave', holdEnd);
    $('btn-save').addEventListener('click', saveLongImage);
    $('btn-share').addEventListener('click', copyShare);
    document.querySelectorAll('[data-action="restart"]').forEach((el) => el.addEventListener('click', restart));
    $('btn-connect').addEventListener('click', openSettings);
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-status').addEventListener('click', openMode);
    $('btn-mode-close').addEventListener('click', closeMode);
    $('btn-mode-settings').addEventListener('click', () => { closeMode(); openSettings(); });
    $('mode-modal').addEventListener('click', (e) => { if (e.target === $('mode-modal')) closeMode(); });
    $('mode-modal').addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const controls = [$('btn-mode-close'), $('btn-mode-settings')];
      if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls[1].focus(); }
      else if (!e.shiftKey && document.activeElement === controls[1]) { e.preventDefault(); controls[0].focus(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('mode-modal').classList.contains('hidden')) closeMode(); });
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
  renderGestures();
  if (!window.isSecureContext) {
    const el = $('phone-insecure');
    el.textContent = '这页是 http 打开的非安全地址，浏览器直接禁用了陀螺仪、加速度计和麦克风——手机动作只能靠「按住不放」。'
      + '要用真传感器：手机上装一次自签证书，或者用 https 隧道（见 README「手机传感器」）。';
    el.classList.remove('hidden');
  }
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
