/* 预赛独立 Demo。预置案例与真实模型响应始终显示来源，不伪装硬件。 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const safeGet = (key) => { try { return localStorage.getItem(key) || ''; } catch { return ''; } };
  const safeSet = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
  const isCrisis = (s) => /自杀|自尽|自残|自伤|轻生|不想活|活不下去|想死|死了算了|割腕|跳楼|安眠药|解脱了|kill myself|suicide|self[-\s]?harm/i.test(s);
  const presets = {
    dali: {
      input: '如果当时我辞职去大理开咖啡店',
      title: '同一个人，两种晨光',
      assumption: '这是人工预置的虚构角色；“继续上班”是示例设定，与体验者的真实生活无关。',
      present: { label: '预置角色 · 假设继续上班', gain: '周五准时收到工资，窗边那盆绿萝在你请假时有人浇水。', cost: '闹钟响起的早晨，偶尔还是会觉得自己活在别人的日程表里。', envy: '羡慕那边的人，有一扇可以自己决定几点打开的店门。' },
      alternate: { label: '预置角色 · 假设开了小店', gain: '你把第一杯咖啡端给沿路看海的陌生人，晨光照亮了菜单。', cost: '旺季站十二小时，淡季要算房租；即使窗外云很好看，账本也不会自己变轻。', envy: '羡慕另一边的人，偶尔真的可以在周五六点关掉电脑。' },
      synthesis: '这个角色想要的也许不是那间店，而是有权决定今天何时开门。',
      presetChallenge: '我在乎的不是收入，而是有权决定自己的时间。',
      revision: { newReading: '稳定的收入和自由的时间，都值得被认真争取；它们不是只能二选一的奖品。', reason: '这个预置场景的异议是“更在乎时间的自主权”。于是结论从具体职业转向可以实践的生活边界。', capsuleLine: '另一条路不负责拯救你；今天也能从一小时属于自己的时间开始。' },
    },
    art: {
      input: '如果当时我学美术而不是计算机',
      title: '画笔与光标的两边',
      assumption: '这是人工预置的虚构角色；“继续写代码”是示例设定，不代表你现实中学了什么。',
      present: { label: '预置角色 · 假设继续写代码', gain: '你把一个麻烦流程变成了别人手机上顺手的一次点击。', cost: '第十七次改动需求时，屏幕的光比天亮得还早。', envy: '羡慕另一边的人，有时能把感受直接落在纸上。' },
      alternate: { label: '预置角色 · 假设学了美术', gain: '画室的夜里，你终于找到一种不需要解释的表达。', cost: '为了买颜料而代课，为了截稿而熬夜；甲方说“再鲜艳一点”。', envy: '羡慕另一边的人，按下运行键就能看见东西动起来。' },
      synthesis: '热爱与谋生从来不是互斥的标签，只是它们都需要你的时间。',
      presetChallenge: '我不觉得必须换职业才能保留对美术的热爱。',
      revision: { newReading: '不必把身份画成单选题。你可以写代码，也可以继续给自己留一张白纸。', reason: '这个预置场景的异议是“不必换职业才配热爱”。修订后，两种实践可以同时存在。', capsuleLine: '这一次，不换路；在这条路的口袋里放一支笔。' },
    },
  };
  const app = {
    apiBase: safeGet('rnt.apiBase') || location.origin,
    apiKey: safeGet('rnt.apiKey'),
    model: safeGet('rnt.model') || 'step-5-preview',
    connected: false, ready: false, mock: false,
    lens: '', presentContext: '', hasPresentContext: false, source: null, input: '', story: null, revision: null, ms: null, revisionMs: null,
    sequence: 0, timer: null, lastFocus: null,
  };
  const screens = ['input', 'loading', 'compare', 'revising', 'revised', 'capsule'];
  const stage = { input: 1, loading: 1, compare: 2, revising: 3, revised: 3, capsule: 4 };
  const stageNames = ['写下岔路', '双路对照', '给 AI 异议', '带走纸芯'];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');

  function show(name) {
    screens.forEach((n) => $(`screen-${n}`).classList.toggle('hidden', n !== name));
    const current = stage[name];
    $('stage-label').textContent = `${String(current).padStart(2, '0')} / ${stageNames[current - 1]}`;
    $('stage-progress').style.width = `${current * 25}%`;
    window.scrollTo({ top: 0, behavior: reduced.matches ? 'instant' : 'smooth' });
    document.title = `${stageNames[current - 1]} · 没走的路`;
  }
  function error(id, text) { $(id).textContent = text; $(id).classList.remove('hidden'); }
  function clearError(id) { $(id).textContent = ''; $(id).classList.add('hidden'); }
  function clock(id) {
    const start = Date.now();
    clearInterval(app.timer);
    $(id).textContent = '已等待 0 秒';
    app.timer = setInterval(() => { $(id).textContent = `已等待 ${Math.floor((Date.now() - start) / 1000)} 秒`; }, 1000);
  }
  function stopClock() { clearInterval(app.timer); app.timer = null; }
  function apiUrl(path) { return `${app.apiBase.replace(/\/+$/, '')}/api/${path}`; }
  async function request(path, body, timeout = 100000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(apiUrl(path), {
        method: body ? 'POST' : 'GET', headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(app.apiKey ? { 'X-Stepfun-Api-Key': app.apiKey } : {}),
          ...(app.model ? { 'X-Stepfun-Model': app.model } : {}),
        }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      if (!(response.headers.get('content-type') || '').includes('json')) throw new Error('本地服务未返回 JSON；请检查服务地址。');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `服务错误 ${response.status}`);
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('等待模型超时。可以重试，或选预置案例体验。');
      if (err instanceof TypeError) throw new Error('无法连接本地服务。请检查服务是否启动，或选预置案例体验。');
      throw err;
    } finally { clearTimeout(timer); }
  }
  async function probe() {
    try {
      const health = await request('health', null, 4500);
      app.connected = true;
      app.mock = !!health.mockLlm;
      app.ready = !app.mock && (!!health.hasServerKey || !!app.apiKey);
    } catch { app.connected = false; app.ready = false; }
    const el = $('status');
    el.className = `status-pill ${app.ready ? 'online' : 'offline'}`;
    el.textContent = app.ready ? '● 实时 AI 已连接' : app.mock ? '○ 预置演示模式' : app.connected ? '○ 需要模型 Key' : '○ 服务未连接';
  }
  function setFocus(lens) {
    app.lens = app.lens === lens ? '' : lens;
    $('lens-custom').value = '';
    document.querySelectorAll('[data-focus]').forEach((btn) => {
      const selected = btn.dataset.focus === app.lens;
      btn.classList.toggle('selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }
  function clearLens() {
    app.lens = '';
    document.querySelectorAll('[data-focus]').forEach((btn) => {
      btn.classList.remove('selected'); btn.setAttribute('aria-pressed', 'false');
    });
  }
  function setInput(text) { $('choice-input').value = text; $('count').textContent = `${text.length} / 100`; }
  function validateInput(text) {
    if (isCrisis(text)) return '这段话值得被认真对待，而不是做成游戏。请联系信任的人；如果有即刻危险，请联系当地急救服务。';
    if (text.length < 10 || text.length > 100) return '请用 10–100 字写下一个具体的“如果当时……”。';
    return '';
  }
  function fill(prefix, path) {
    $(`${prefix}-label`).textContent = path.label;
    $(`${prefix}-gain`).textContent = path.gain;
    $(`${prefix}-cost`).textContent = path.cost;
    $(`${prefix}-envy`).textContent = path.envy;
  }
  function renderCompare() {
    const story = app.story;
    $('story-title').textContent = story.title;
    $('assumption-text').textContent = story.assumption;
    $('synthesis').textContent = story.synthesis;
    fill('now', story.present); fill('other', story.alternate);
    const live = app.source === 'ai';
    const unknown = live && !app.hasPresentContext;
    $('result-copy').textContent = unknown ? '这里只想象没走的路；现实中的你保持未知。' : live ? '两边都是基于你提供的线索所写的虚构情境，不是人生预测。' : '这是预置虚构角色的两条路，不是你的真实经历。';
    $('revise-label').textContent = live ? '让 AI 再想一遍' : '看预置的改判示例';
    $('now-meta').textContent = unknown ? '01 / CURRENT LIFE: UNKNOWN' : live ? '01 / FICTION BASED ON YOUR CLUE' : '01 / PRESET FICTION';
    $('now-gain-label').textContent = unknown ? '现实的所得' : '可能的所得';
    $('now-cost-label').textContent = unknown ? '现实的代价' : '可能的代价';
    $('now-envy-label').textContent = unknown ? '你真正的感受' : '可能的回望';
    $('source-tag').textContent = live ? (unknown ? '● 实时 AI · 未走之路' : '● 实时 AI · 双路情境') : '● 预置虚构案例';
    $('source-tag').classList.toggle('live', live);
    $('tech-text').textContent = live
      ? `${app.lens ? `你自选了“${app.lens}”关注角度。` : '没有指定关注角度。'}${unknown ? '你未提供现状：模型只生成没走的路，现实卡片是服务端固定留白文案。' : '你自愿补充了一句现状线索；现实卡片为基于线索的虚构推演，不是事实。'}模型 ${app.model} 用时 ${(app.ms / 1000).toFixed(1)} 秒。若提出异议，会再发送原故事与异议给模型；未使用 AI 出图。`
      : '这是人工预先编写、审核过的虚构角色案例，没有调用模型；你在输入页填写的现状和关注点均不会改变它，也不会被发送。插画为预置 CSS/SVG 图形。';
    $('assumption-panel').classList.add('hidden'); $('assumption-toggle').setAttribute('aria-expanded', 'false');
    $('tech-panel').classList.add('hidden'); $('tech-toggle').setAttribute('aria-expanded', 'false');
    $('path-grid').classList.remove('swapped');
    const preset = !live;
    $('challenge-input').value = '';
    $('challenge-input').readOnly = preset;
    $('challenge-input').placeholder = preset ? '请点击下方的预置异议' : '比如：我其实更在乎自己支配时间，而不是收入';
    $('challenge-explainer').textContent = preset
      ? '此案例为静态演示，只能选择固定异议；想让 AI 真正回应你的观点，请连接模型。'
      : '第二次模型调用只改判读，不重写你没说过的经历。';
    const choices = document.querySelectorAll('[data-challenge]');
    choices[0].dataset.challenge = preset ? story.presetChallenge : '我在乎的不是收入，而是有权决定自己的时间。';
    choices[0].textContent = preset ? `预置异议：${story.presetChallenge}` : '我在乎时间';
    choices[1].classList.toggle('hidden', preset);
    show('compare');
  }
  async function generate() {
    const text = $('choice-input').value.trim();
    clearError('form-error');
    const issue = validateInput(text);
    if (issue) return error('form-error', issue);
    if (!app.ready) return error('form-error', '自定义输入需要真实 AI 连接。请在右上角设置可信的本地服务和模型 Key，或点击下方预置案例。');
    const presentContext = $('present-details').open ? $('present-input').value.trim() : '';
    const lens = $('lens-custom').value.trim() || app.lens;
    if (presentContext && (presentContext.length < 4 || isCrisis(presentContext))) return error('form-error', '现实线索请写 4–80 字；若涉及危机，先暂停游戏并联系可信的人或当地专业援助。');
    if (lens && (lens.length < 2 || isCrisis(lens))) return error('form-error', '关注点请写 2–30 字，避免输入敏感经历。');
    const ticket = ++app.sequence;
    app.input = text; app.lens = lens; app.presentContext = presentContext; app.hasPresentContext = Boolean(presentContext); app.source = 'ai'; app.revision = null;
    show('loading'); clock('elapsed');
    try {
      const data = await request('parallel/create', { text, presentContext, lens });
      if (ticket !== app.sequence) return;
      app.story = data.story; app.ms = data.durationMs; app.hasPresentContext = data.hasPresentContext === true;
      stopClock(); renderCompare();
    } catch (err) {
      if (ticket !== app.sequence) return;
      stopClock(); show('input'); error('form-error', err.message);
    }
  }
  function usePreset(id) {
    const item = presets[id]; if (!item) return;
    ++app.sequence; stopClock(); clearError('form-error');
    setInput(item.input); $('present-input').value = ''; $('present-details').open = false; $('lens-custom').value = ''; clearLens();
    app.input = item.input; app.presentContext = ''; app.hasPresentContext = false; app.story = item; app.source = 'preset'; app.ms = null; app.revision = null;
    renderCompare();
  }
  async function revise() {
    const challenge = $('challenge-input').value.trim(); clearError('challenge-error');
    if (isCrisis(challenge)) return error('challenge-error', '这次先暂停游戏。请联系信任的人或当地专业援助；有即刻危险请联系当地急救服务。');
    if (challenge.length < 5) return error('challenge-error', '请具体写下你的不同看法（至少 5 字）。');
    if (app.source === 'preset') {
      if (challenge !== app.story.presetChallenge) return error('challenge-error', '预置案例只包含这一条固定异议，请点击下方按钮；自定义质疑需要连接模型。');
      app.revision = { oldReading: app.story.synthesis, ...app.story.revision };
      app.revisionMs = null; renderRevision(); return;
    }
    const ticket = ++app.sequence;
    show('revising'); clock('revision-elapsed');
    try {
      const data = await request('parallel/revise', { text: app.input, lens: app.lens, original: {
        title: app.story.title, assumption: app.story.assumption, present: app.story.present,
        alternate: app.story.alternate, synthesis: app.story.synthesis,
      }, challenge });
      if (ticket !== app.sequence) return;
      app.revision = data.revision; app.revisionMs = data.durationMs;
      stopClock(); renderRevision();
    } catch (err) {
      if (ticket !== app.sequence) return;
      stopClock(); show('compare'); error('challenge-error', `${err.message} 初稿已保留，可以重试或直接制作电子纸芯。`);
    }
  }
  function renderRevision() {
    $('old-reading').textContent = app.revision.oldReading;
    $('new-reading').textContent = app.revision.newReading;
    $('reason').textContent = app.revision.reason;
    const live = app.source === 'ai';
    $('revision-source').textContent = live ? `● 真实 AI 改判 · ${(app.revisionMs / 1000).toFixed(1)} 秒` : '● 固定异议的预置示例 · 未调用 AI';
    $('revision-source').classList.toggle('live', live);
    show('revised');
  }
  function capsule() {
    $('paper-line').textContent = app.revision?.capsuleLine || app.story.synthesis;
    $('paper-present-label').textContent = app.source === 'preset' ? '预置角色的现在：虚构' : app.hasPresentContext ? '现在：基于线索想象' : '现在：未知，由你定义';
    show('capsule');
  }
  function restart() {
    ++app.sequence; stopClock(); app.story = null; app.revision = null; app.source = null;
    setInput(''); $('present-input').value = ''; $('present-details').open = false; $('lens-custom').value = ''; clearLens(); app.presentContext = ''; app.hasPresentContext = false;
    $('challenge-input').value = ''; clearError('form-error'); clearError('challenge-error');
    show('input'); $('choice-input').focus({ preventScroll: true });
  }
  function togglePanel(button, panel) {
    const expand = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expand));
    panel.classList.toggle('hidden', !expand);
  }
  let settingsReturn = null;
  function openSettings() {
    settingsReturn = document.activeElement;
    $('api-base').value = app.apiBase;
    $('api-key').value = app.apiKey;
    $('model').value = app.model;
    $('settings-modal').classList.remove('hidden');
    $('settings-close').focus();
  }
  function closeSettings() { $('settings-modal').classList.add('hidden'); settingsReturn?.focus(); }
  $('choice-input').addEventListener('input', (event) => { $('count').textContent = `${event.target.value.length} / 100`; clearError('form-error'); });
  document.querySelectorAll('[data-focus]').forEach((btn) => btn.addEventListener('click', () => setFocus(btn.dataset.focus)));
  $('lens-custom').addEventListener('input', () => { clearLens(); clearError('form-error'); });
  $('present-details').addEventListener('toggle', () => { if (!$('present-details').open) $('present-input').value = ''; });
  document.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => usePreset(btn.dataset.preset)));
  $('generate').addEventListener('click', generate);
  $('loading-back').addEventListener('click', () => { ++app.sequence; stopClock(); show('input'); });
  $('swap-view').addEventListener('click', () => $('path-grid').classList.toggle('swapped'));
  $('assumption-toggle').addEventListener('click', () => togglePanel($('assumption-toggle'), $('assumption-panel')));
  $('tech-toggle').addEventListener('click', () => togglePanel($('tech-toggle'), $('tech-panel')));
  document.querySelectorAll('[data-challenge]').forEach((btn) => btn.addEventListener('click', () => { $('challenge-input').value = btn.dataset.challenge; clearError('challenge-error'); $('challenge-input').focus(); }));
  $('revise').addEventListener('click', revise);
  $('revision-back').addEventListener('click', () => { ++app.sequence; stopClock(); show('compare'); });
  $('skip').addEventListener('click', capsule);
  $('to-capsule').addEventListener('click', capsule);
  $('print-paper').addEventListener('click', () => window.print());
  $('restart').addEventListener('click', restart);
  $('settings-open').addEventListener('click', openSettings);
  $('status').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', closeSettings);
  $('settings-modal').addEventListener('click', (e) => { if (e.target === $('settings-modal')) closeSettings(); });
  $('settings-modal').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
    if (e.key !== 'Tab') return;
    const controls = [...$('settings-modal').querySelectorAll('button,input,select')];
    if (e.shiftKey && document.activeElement === controls[0]) { e.preventDefault(); controls.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0].focus(); }
  });
  $('settings-save').addEventListener('click', () => {
    const base = $('api-base').value.trim().replace(/\/+$/, '');
    if (base) { app.apiBase = base; safeSet('rnt.apiBase', base); }
    app.apiKey = $('api-key').value.trim(); app.model = $('model').value;
    safeSet('rnt.apiKey', app.apiKey); safeSet('rnt.model', app.model);
    closeSettings(); void probe();
  });
  void probe();
})();
