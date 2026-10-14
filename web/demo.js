/* 没走的路 · 后悔药贩卖机（移动端 Demo）。
   规则：写一句 → 对着机器做一个动作 → 拿票卷进胶囊。
   页面从不假装硬件做完了：没连机器就说没连，动画是动画。 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const safeGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const isCrisis = (s) => /自杀|自尽|自残|自伤|自虐|轻生|不想活|活不下去|想死|死了算了|割腕|跳楼|安眠药|解脱了|一了百了|结束生命|了结自己|伤害自己|撑不下去了|kill myself|suicide|self[-\s]?harm/i.test(s);

  /* 等待时的机器台词：毒舌人设，但只损那条路，不损坐着的人 */
  const WAIT_LINES = [
    '机器正在读你那条路的广告词。',
    '正在找这条路上没人提前告诉你的那几笔账。',
    '正在问那边的你，最近过得怎么样。',
    '别催。那边的你也在加班。',
    '正在把"如果能重来"折成一张小票。',
    '正在确认：那条路也没给你开后门。',
    '正在给那条路拍一张不打光的照片。',
  ];

  /* 三个动作：动作名就是动作本身，说明只有一行大白话 */
  const ACTIONS = {
    flip: { name: '翻个面', line: '看看这条路背面写了什么小字', key: '背面的小字', challenge: '翻个面：把这条路没写进广告的小字翻出来看看。' },
    shake: { name: '摇一摇', line: '把没写进广告的账单摇出来', key: '摇出来的账单', challenge: '摇一摇：把这条路上没写进广告的账单摇出来。' },
    press: { name: '按住不放', line: '听那个我吐槽两句', key: '那个我的吐槽', challenge: '按住不放：让平行世界的我自己出来吐槽两句。' },
  };

  /* 现成案例：没网、没 Key 时也能走完整流程（页面会标注“没调用 AI”） */
  const PRESETS = {
    dali: {
      label: '辞职去大理开咖啡店',
      story: {
        title: '海边小店：本店全年无休',
        assumption: '这是提前写好的虚构角色，和你的真实生活没关系。',
        alternate: {
          label: '没走的那条路（虚构）',
          gain: '洱海边一扇白墙木窗。第一杯手冲端出去，海是蓝的，客人说"这就是生活"，你连拍十七张，够发一整年。',
          cost: '旺季三桌客人同时预约最佳落日位；淡季房东、豆商和平台抽成开了个会，一致通过：旺季延长、淡季涨价、抽成照旧。',
          envy: '店里的我说：这店是我的，也是房东的、平台的、豆商的，排到最后才轮到我。',
        },
        synthesis: '海风不打卡，账单打。',
      },
      revisions: {
        flip: { newReading: '路牌背面一行小字：本店全年无休，日出归你管，涨价随缘，雨天不退。', capsuleLine: '那边的日出很准时，账单也是。' },
        shake: { newReading: '摇出四笔账：房租、豆价、平台抽成、一次性纸杯的环保附加费。它们按时开会，你按时上班。', capsuleLine: '在那条路上，账单会组团点单。' },
        press: { newReading: '另一个我说：别问了，我正忙着给咖啡机排年假，排在它自己后面。', capsuleLine: '那家店的咖啡机也想下班。' },
      },
    },
    art: {
      label: '学美术而不是计算机',
      story: {
        title: '画室很自由，甲方更自由',
        assumption: '这是提前写好的虚构角色，不代表你现实里学了什么。',
        alternate: {
          label: '没走的那条路（虚构）',
          gain: '画室熄灯前，松节油盖过泡面味。老师站你背后看了三秒，说"你有天赋"——这三个字你存了两年。',
          cost: '颜料刚拆封，截稿日提前四天。甲方说"再鲜艳一点"，你把同一套配色交到第八版；第九版他问你，能不能回到第七版。',
          envy: '画室里的我说：别问我后不后悔，我正忙着给第八版盖一层更鲜艳的灰。',
        },
        synthesis: '画室很自由，甲方更自由。',
      },
      revisions: {
        flip: { newReading: '灯管背面贴着：本教室允许通宵，电费按灵感结算，灵感按分钟超时。', capsuleLine: '那边的加班费，按月结算不了。' },
        shake: { newReading: '颜料、画布、快递费一起涨。房东顺手把房租调成了"高饱和"，说这是行业惯例。', capsuleLine: '那边的配色很高饱和，账单也是。' },
        press: { newReading: '另一个我说：别问了，我在给插座写作品说明，甲方说明天要。', capsuleLine: '那边的橡皮擦得掉铅笔，擦不掉甲方消息。' },
      },
    },
    beijing: {
      label: '毕业后留在北京',
      story: {
        title: '留在北京：窗户朝西，时间朝甲方',
        assumption: '这是提前写好的虚构角色，和你的真实生活没关系。',
        alternate: {
          label: '没走的那条路（虚构）',
          gain: '你在三环里租到一间朝北的屋子。睡前刷到的全是行业峰会、"北京凌晨四点"和别人的入职照。',
          cost: '地铁、日程表和外卖提醒轮流当闹钟。你刚挤上早班车，工牌就提醒你下班后还有一场对齐会。',
          envy: '工位上的我说：我住的地方朝北，我的窗户朝西，我的时间朝甲方。',
        },
        synthesis: '日出看到了，工位也到了。',
      },
      revisions: {
        flip: { newReading: '租房合同第七页小字：隔断不隔音，押一付三，提前退租请把墙刷回原来的白。', capsuleLine: '那边的房间朝北，押金朝南。' },
        shake: { newReading: '摇出四笔：房租、通勤、外卖，还有体检报告上那行"建议复查"。它们四季常青。', capsuleLine: '那边的账单有工牌，也是打卡制。' },
        press: { newReading: '另一个我说：别问了，我在给工牌充电，它比我更需要续航。', capsuleLine: '那边的工牌活得很健康。' },
      },
    },
    stay: {
      label: '如果当时没有和他分手',
      story: {
        title: '没分手：先装茶几',
        assumption: '这是提前写好的虚构角色，和你的真实感情生活没关系。',
        alternate: {
          label: '没走的那条路（虚构）',
          gain: '你们养了只猫，周末去宜家买了张谁看都说"挺温馨"的茶几，朋友圈里你们是模范情侣。',
          cost: '茶几说明书少画了一颗螺丝，猫负责把剩下的螺丝藏起来。三年后你们找到那颗螺丝，吵了一架，关于是谁弄丢的。',
          envy: '客厅里的我说：感情没散，茶几差点。我们现在最熟练的技能，是沉默着拼家具。',
        },
        synthesis: '感情没散，茶几差点。',
      },
      revisions: {
        flip: { newReading: '说明书最后一页：建议两人安装，不建议两人边装边讨论谁做得多。', capsuleLine: '那边的说明书，没写这一条。' },
        shake: { newReading: '摇出三笔：猫粮、扫地机器人，还有每次吵完点的那份双人火锅外卖。', capsuleLine: '那边的和解成本，按顿结算。' },
        press: { newReading: '另一个我说：别问了，我在找那颗螺丝，已经找到第三年了。', capsuleLine: '那边的猫，至今没有归还赃物。' },
      },
    },
  };

  /* 票面插画：本地矢量线稿，按文案关键词挑一张。
     不是实时 AI 出图——这句话也写在 DEMO_UI_ART_BRIEF 里，别对外说成生成图。 */
  const S = (inner) => `<svg viewBox="0 0 120 62" preserveAspectRatio="xMidYMid meet" fill="none" stroke="#14131A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const SCENES = {
    window: S(`<rect x="12" y="6" width="52" height="38" rx="3"/><path d="M38 6v38M12 25h52"/><circle cx="88" cy="16" r="8"/><path d="M80 30h26M80 36h20"/><path d="M8 50h104"/><path d="M20 50v-7a7 7 0 0 1 14 0v7"/><path d="M34 44h4a3.5 3.5 0 0 1 0 7"/><path d="M58 50c0-9 4-13 9-13"/>`),
    desk: S(`<path d="M6 48h108"/><path d="M34 48l-5-24h40l5 24"/><rect x="32" y="16" width="34" height="19" rx="2"/><path d="M39 23h12M39 29h19"/><path d="M78 48V36h11v12"/><circle cx="98" cy="12" r="7"/><path d="M98 19v16"/>`),
    queue: S(`<path d="M6 52h108"/><circle cx="26" cy="18" r="6"/><path d="M26 24v13M26 37l-6 9M26 37l6 9"/><circle cx="58" cy="18" r="6"/><path d="M58 24v13M58 37l-6 9M58 37l6 9"/><circle cx="90" cy="18" r="6"/><path d="M90 24v13M90 37l-6 9M90 37l6 9"/><path d="M8 8h14v10l-3.5-2-3.5 2-3.5-2L8 18z"/><path d="M8 12h14"/>`),
    machine: S(`<rect x="30" y="10" width="46" height="38" rx="5"/><rect x="39" y="19" width="18" height="10" rx="2"/><path d="M43 38v6"/><path d="M28 48h50"/><path d="M84 26h10l-2 12H86z"/><path d="M92 30h4a3 3 0 0 1 0 6"/><path d="M14 6h92"/>`),
    mirror: S(`<rect x="8" y="6" width="38" height="46" rx="19"/><circle cx="27" cy="22" r="6"/><path d="M27 28v11M27 39l-6 9M27 39l6 9"/><path d="M58 12h48a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H78l-9 9v-9h-11a5 5 0 0 1-5-5V17a5 5 0 0 1 5-5z"/><path d="M70 20h24M70 27h16"/>`),
  };
  const MOTIFS = [
    [/窗|海|晨光|阳光|海风|阳台|院子|旅行|风景|落地窗|大理/, 'window'],
    [/咖啡|吧台|客人|店|收银|机器|设备|出杯/, 'machine'],
    [/改稿|甲方|加班|代码|屏幕|方案|审批|会议|KPI|报表|电脑|工位|老板|稿/, 'desk'],
    [/排队|账单|房租|豆价|涨|抽成|快递|地铁|通勤|证件|签证|手续|报到|挂号|平台/, 'queue'],
  ];
  function sceneFor(text, fallback) {
    for (const [re, name] of MOTIFS) if (re.test(text)) return SCENES[name];
    return SCENES[fallback];
  }

  const app = {
    apiBase: safeGet('rnt.apiBase') || location.origin,
    apiKey: safeGet('rnt.apiKey') || '',
    model: safeGet('rnt.model') || 'step-5-preview',
    connected: false, ready: false, mock: false, deviceOnline: false,
    presentContext: '', source: null, input: '', story: null, ms: null,
    action: 'flip', actionDone: false, extra: null, capsuleLine: '', timer: null, spin: null, seq: 0,
  };
  const screens = ['start', 'wait', 'ticket', 'print', 'capsule'];
  const step = { start: 1, wait: 1, ticket: 2, print: 2, capsule: 3 };

  function show(name) {
    screens.forEach((n) => $(`screen-${n}`).classList.toggle('hidden', n !== name));
    document.body.dataset.screen = name;
    document.querySelectorAll('.dot').forEach((d) => d.classList.toggle('on', Number(d.dataset.step) <= step[name]));
    window.scrollTo({ top: 0, behavior: reduced.matches ? 'instant' : 'smooth' });
    $('actionbar').hidden = name !== 'ticket';
  }
  const err = (text) => { $('form-error').textContent = text; $('form-error').hidden = !text; };
  function clock(id) {
    const t0 = Date.now();
    clearInterval(app.timer);
    clearInterval(app.spin);
    $(id).textContent = '已等 0 秒';
    app.timer = setInterval(() => { $(id).textContent = `已等 ${Math.floor((Date.now() - t0) / 1000)} 秒`; }, 1000);
    let i = Math.floor(Math.random() * WAIT_LINES.length);
    $('wait-lede').textContent = WAIT_LINES[i];
    app.spin = setInterval(() => {
      i = (i + 1) % WAIT_LINES.length;
      const el = $('wait-lede');
      el.style.opacity = '0';
      setTimeout(() => { el.textContent = WAIT_LINES[i]; el.style.opacity = '1'; }, 220);
    }, 2400);
  }
  const stopClock = () => { clearInterval(app.timer); clearInterval(app.spin); app.timer = null; app.spin = null; };

  function apiUrl(path) { return `${app.apiBase.replace(/\/+$/, '')}/api/${path}`; }
  async function request(path, body, timeout = 100000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(apiUrl(path), {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(app.apiKey ? { 'X-Stepfun-Api-Key': app.apiKey } : {}),
          ...(app.model ? { 'X-Stepfun-Model': app.model } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('本地服务没返回 JSON，检查一下服务地址。');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `服务报错 ${res.status}`);
      return data;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('模型这次卡住了，重试一下，或者先玩现成案例。');
      if (e instanceof TypeError) throw new Error('没连上本地服务。看看服务开没开，也可以先玩现成案例。');
      throw e;
    } finally { clearTimeout(t); }
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
    el.textContent = app.ready ? 'AI 在线' : app.mock ? '现成案例' : app.connected ? '缺 Key' : '服务没连';
    try {
      const d = await request('device/status', null, 4000);
      app.deviceOnline = !!d.connected;
    } catch { app.deviceOnline = false; }
    const badge = $('device-badge');
    badge.hidden = !app.deviceOnline;
    if (app.deviceOnline) badge.textContent = '机器在线';
  }

  /* ---------------- 生成 ---------------- */
  async function start(presetId) {
    const preset = presetId ? PRESETS[presetId] : null;
    const text = preset ? preset.label : $('choice-input').value.trim();
    if (!preset) {
      const bad = isCrisis(text)
        ? '这段先别拿来玩。请联系你信任的人；如果有马上伤害自己的风险，直接联系当地急救服务。'
        : text.length < 10 || text.length > 100 ? '写具体一点，10～100 字就行。别只扔一句“要是当时”。' : '';
      if (bad) { err(bad); return; }
    }
    err('');
    app.input = text; app.source = preset ? 'preset' : 'ai'; app.actionDone = false; app.extra = null;
    show('wait'); clock('elapsed');
    if (preset) {
      await new Promise((r) => setTimeout(r, reduced.matches ? 120 : 900));
      stopClock(); app.story = preset.story; app.ms = null; renderTicket(); return;
    }
    try {
      const data = await request('parallel/create', { text, presentContext: $('present-input').value.trim(), lens: '' });
      app.story = data.story; app.ms = data.durationMs;
      stopClock(); renderTicket();
    } catch (e) {
      stopClock();
      $('elapsed').textContent = '这台机器今天不配合';
      $('screen-wait').querySelector('h2').textContent = '糖衣没灌成。';
      $('screen-wait').querySelector('.lede').textContent = e.message;
    }
  }

  function renderTicket() {
    const s = app.story;
    $('ticket-no').textContent = $('ticket-no-2').textContent = `NO.${String(++app.seq).padStart(4, '0')}`;
    const art1 = sceneFor(s.alternate.gain, 'window');
    $('ticket-title').textContent = s.title;
    $('ticket-sugar').textContent = app.input;
    $('ticket-assumption').textContent = s.assumption || '这条路上的一切都是虚构的。';
    $('cap-1').textContent = $('cap-1b').textContent = s.alternate.gain;
    $('cap-2').textContent = s.alternate.cost;
    $('cap-3').textContent = s.alternate.envy;
    $('art-1').innerHTML = art1;
    $('art-1b').innerHTML = art1;
    $('art-2').innerHTML = sceneFor(s.alternate.cost, 'queue');
    $('art-3').innerHTML = SCENES.mirror;
    $('ticket-foot').textContent = s.synthesis;
    $('extra-wrap').classList.add('hidden');
    $('ticket-extra').textContent = '';
    $('flipper').classList.remove('flipped');
    document.body.classList.remove('did-act');
    document.querySelector('.ticket-stage').classList.remove('tall');
    $('capsule-line').textContent = '';
    $('ticket-note').textContent = app.source === 'ai'
      ? `模型刚写完，${((app.ms || 0) / 1000).toFixed(1)} 秒。这条路上的一切都是虚构的。`
      : '现成案例：这局没调用 AI，你刚才写的内容也没发出去。';
    setAction(app.action); setBarPhase('pick');
    show('ticket');
    syncCues();
  }

  /* ---------------- 动作 ---------------- */
  function setAction(kind) {
    app.action = kind;
    document.querySelectorAll('[data-action]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.action === kind)));
    const a = ACTIONS[kind];
    $('main-action').textContent = a.name;
    $('action-hint').textContent = `${a.line}。做完票就翻到背面。`;
    $('manual').hidden = true;
  }
  function setBarPhase(phase) {
    const picking = phase === 'pick';
    $('action-pick').hidden = !picking;
    $('action-hint').hidden = !picking;
    if (!picking) $('main-action').textContent = '卷进胶囊 →';
  }
  const needsPermission = () => typeof DeviceOrientationEvent !== 'undefined'
    && typeof DeviceOrientationEvent.requestPermission === 'function';

  const sensor = { armed: null, base: null, hits: 0, last: 0, got: false, timer: null, granted: false };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function onOrient(e) {
    if (e.gamma !== null && e.beta !== null) { $('holo').style.setProperty('--px', `${clamp(50 + e.gamma * 1.1, 0, 100)}%`); $('holo').style.setProperty('--py', `${clamp(50 + (e.beta - 45) * 0.9, 0, 100)}%`); }
    if (!sensor.armed || sensor.armed.kind !== 'flip') return;
    const { beta, gamma } = e;
    if (beta === null || gamma === null) return;
    sensor.got = true;
    if (!sensor.base) { sensor.base = { beta, gamma }; return; }
    const d = Math.max(Math.abs(beta - sensor.base.beta), Math.abs(gamma - sensor.base.gamma));
    if (d > 110) completeAction('sensor');
  }
  function onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null) return;
    if (!sensor.armed || sensor.armed.kind !== 'shake') return;
    sensor.got = true;
    const mag = Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2) / 9.81;
    const now = Date.now();
    if (mag > 2.1 && now - sensor.last > 260) { sensor.last = now; sensor.hits++; if (sensor.hits >= 3) completeAction('sensor'); }
  }
  if (typeof DeviceOrientationEvent !== 'undefined') window.addEventListener('deviceorientation', onOrient);
  if (typeof DeviceMotionEvent !== 'undefined') window.addEventListener('devicemotion', onMotion);

  async function askPermission() {
    try {
      if (needsPermission()) await DeviceOrientationEvent.requestPermission();
      if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') await DeviceMotionEvent.requestPermission();
    } catch { /* 拒绝了也能玩：下面有手动确认兜底 */ }
    sensor.granted = true;
  }

  function arm(kind) {
    clearTimeout(sensor.timer);
    sensor.armed = { kind }; sensor.base = null; sensor.hits = 0; sensor.last = 0; sensor.got = false;
    $('manual').hidden = true;
    $('main-action').textContent = kind === 'flip' ? '把手机翻过去' : kind === 'shake' ? '摇三下' : '按住不放';
    $('action-hint').textContent = kind === 'flip' ? '把手机翻个面，屏幕朝下再翻回来。' : '摇三下，用力点。';
    sensor.timer = setTimeout(() => { if (!app.actionDone) $('manual').hidden = false; }, 3000);
  }

  function holdStart(ev) {
    if (app.action !== 'press') return;
    ev.preventDefault();
    const btn = $('main-action');
    const t0 = Date.now();
    btn.classList.add('holding');
    $('main-action').textContent = '按住……别松手';
    const raf = () => {
      if (!hold.on) return;
      const p = Math.min(1, (Date.now() - t0) / 1800);
      btn.style.background = `linear-gradient(100deg, #FF4F85 ${p * 100}%, #FF693A ${p * 100}%, #FF693A)`;
      if (p < 1) requestAnimationFrame(raf);
    };
    const hold = { on: true };
    requestAnimationFrame(raf);
    const up = () => {
      hold.on = false; window.removeEventListener('pointerup', up);
      btn.classList.remove('holding');
      btn.style.background = '';
      if (Date.now() - t0 >= 1800) completeAction('hold');
      else { $('main-action').textContent = '按住不放'; $('action-hint').textContent = '松早了。再来一次，按够两秒。'; }
    };
    window.addEventListener('pointerup', up, { once: true });
  }

  async function completeAction(via) {
    if (app.actionDone) return;
    app.actionDone = true;
    sensor.armed = null; clearTimeout(sensor.timer);
    $('manual').hidden = true;
    if (navigator.vibrate) navigator.vibrate(via === 'manual' ? 18 : [14, 40, 14]);
    $('main-action').textContent = '别动，机器在印背面…';
    $('main-action').disabled = true;
    const extra = await revise();
    app.extra = extra;
    $('extra-key').textContent = `你的动作 · ${ACTIONS[app.action].key}`;
    $('ticket-extra').textContent = extra.newReading;
    $('extra-wrap').classList.remove('hidden');
    $('capsule-line').textContent = extra.capsuleLine || '';
    $('ticket-note').textContent = app.source === 'ai'
      ? '这段小字是刚刚为你的动作单独写的。'
      : '现成案例：这一段也提前写好了，全程没调用 AI。';
    await printRun();
    $('flipper').classList.add('flipped');
    document.body.classList.add('did-act');
    syncCues();
    document.querySelector('.ticket-stage').classList.add('tall');
    $('main-action').disabled = false;
    setBarPhase('done');
  }

  async function revise() {
    const preset = app.source === 'preset';
    if (preset) {
      const found = Object.values(PRESETS).find((p) => p.label === app.input);
      await new Promise((r) => setTimeout(r, reduced.matches ? 80 : 700));
      return (found || PRESETS.dali).revisions[app.action];
    }
    try {
      const data = await request('parallel/revise', {
        text: app.input, lens: '', original: app.story,
        challenge: ACTIONS[app.action].challenge, challengeType: app.action,
      });
      return data.revision;
    } catch (e) {
      return { newReading: `机器印到一半卡住了：${e.message}。背面先留白，动作本身是真的做过了。`, capsuleLine: '' };
    }
  }

  async function printRun() {
    $('print-note').textContent = app.deviceOnline
      ? '现场机器也在打同一张票；出仓以传感器回报为准。'
      : '这台演示机没连实体打印机，下面这卷纸是页面动画。';
    const bar = $('actionbar');
    const wasHidden = bar.hidden;
    bar.hidden = true;
    show('print');
    $('actionbar').hidden = true;
    await new Promise((r) => setTimeout(r, reduced.matches ? 200 : 2100));
    show('ticket');
    bar.hidden = false;
    void wasHidden;
  }

  /* ---------------- 胶囊 ---------------- */
  function toCapsule() {
    show('capsule');
    const line = app.extra?.capsuleLine;
    $('capsule-line').textContent = line ? `胶囊标签：${line}` : '胶囊标签：这条路的副作用，已核验。';
  }

  /* 票面比一屏长时提示「还能往下翻」，滚到底自动收掉 */
  function watchFace(face) {
    if (!face) return;
    const sync = () => {
      const more = face.scrollHeight - face.clientHeight > 24;
      face.classList.toggle('short', !more);
      face.classList.toggle('at-end', face.scrollTop + face.clientHeight >= face.scrollHeight - 6);
    };
    face.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    face._syncCue = sync;
    sync();
  }
  const syncCues = () => requestAnimationFrame(() => {
    document.querySelectorAll('.face').forEach((f) => (f._syncCue ? f._syncCue() : watchFace(f)));
  });

  /* ---------------- 事件 ---------------- */
  $('choice-input').addEventListener('input', (e) => { $('count').textContent = `${e.target.value.length} / 100`; });
  document.querySelectorAll('.face').forEach(watchFace);
  $('generate').addEventListener('click', () => start(null));
  document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => start(b.dataset.preset)));
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => show(b.dataset.back)));
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => setAction(b.dataset.action)));
  $('manual').addEventListener('click', () => completeAction('manual'));
  $('main-action').addEventListener('pointerdown', async (e) => {
    if (app.actionDone) return;
    if (app.action === 'press') { holdStart(e); return; }
    // 手机第一次要用户点头才给感应：这一下点击本身就是那个手势。
    if (needsPermission() && !sensor.granted) await askPermission();
    arm(app.action);
  });
  $('main-action').addEventListener('click', () => { if (app.actionDone) toCapsule(); });
  $('restart').addEventListener('click', () => { $('choice-input').value = ''; $('count').textContent = '0 / 100'; show('start'); });
  $('print-save').addEventListener('click', () => window.print());
  const stage = document.querySelector('.ticket-stage');
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    $('holo').style.setProperty('--px', `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    $('holo').style.setProperty('--py', `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  });

  /* 弹窗 */
  const open = (id) => { $(id).hidden = false; };
  const close = (id) => { $(id).hidden = true; };
  $('status').addEventListener('click', () => {
    $('mode-description').textContent = app.ready
      ? `你写的路会实时发给模型；模型写糖衣和背面小字。模型：${app.model}。`
      : app.mock ? '服务端开着 MOCK_LLM，只能用现成案例。' : app.connected ? '本地服务连上了，还差一个 Key。' : '没连上本地服务，先用现成案例。';
    $('mode-advice').textContent = app.deviceOnline
      ? '实体机器在线：动作也做在机器上，出仓以机器回报为准。'
      : '机器没连上：动作做在手机上（真的翻、真的摇、真的按住），页面会如实标注。';
    open('mode-modal');
  });
  $('mode-close').addEventListener('click', () => close('mode-modal'));
  $('mode-settings').addEventListener('click', () => { close('mode-modal'); openSettings(); });
  function openSettings() {
    $('api-base').value = app.apiBase; $('api-key').value = app.apiKey; $('model').value = app.model;
    open('settings-modal');
  }
  $('settings-open').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => close('settings-modal'));
  $('settings-save').addEventListener('click', async () => {
    app.apiBase = $('api-base').value.trim() || location.origin;
    app.apiKey = $('api-key').value.trim();
    app.model = $('model').value;
    safeSet('rnt.apiBase', app.apiBase); safeSet('rnt.apiKey', app.apiKey); safeSet('rnt.model', app.model);
    close('settings-modal');
    await probe();
  });

  show('start');
  void probe();
})();
