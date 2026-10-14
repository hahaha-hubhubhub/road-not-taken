/**
 * 真实浏览器端到端检查（Chrome DevTools Protocol）。
 *
 * 与 --dump-dom 不同：这个脚本会等页面真正跑完（包括 20-60 秒的模型生成），
 * 然后读取 DOM 状态，避免"加载完就 dump"造成的假阳性。
 *
 *   npm run browser-check -- http://127.0.0.1:8787/ 90000
 *   npm run browser-check -- "http://127.0.0.1:8787/?autostart=如果我当时..." 90000
 */

import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9222);
const url = process.argv[2] ?? 'http://127.0.0.1:8787/';
const waitMs = Number(process.argv[3] ?? 90000);
/** 可选：把 Key 写进页面 localStorage，模拟用户在「设置」里填过 Key */
const testKey = process.argv[4] || process.env.RNT_TEST_KEY || '';
const allowDemo = process.env.RNT_ALLOW_DEMO === '1';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const PROBE = `(() => {
 const visible=id=>{const e=document.getElementById(id);return e&&!e.hidden?'visible':'hidden';};
 return JSON.stringify({views:{home:visible('home'),pill:visible('pill-screen'),input:visible('input-screen'),waiting:visible('waiting-screen'),output:visible('output-screen'),story:visible('story-screen'),envelope:visible('envelope-screen'),letter:visible('letter-screen'),result:visible('receipt-screen')},phase:document.getElementById('output-screen')?.dataset.phase,actLabels:document.querySelectorAll('#receipt-body section').length,hasQr:!!document.getElementById('qr-image')?.src,demoChoice:visible('demo-choice'),errorText:document.getElementById('error')?.textContent,settingsOpen:document.getElementById('settings')?.open,statusText:document.getElementById('connection-status')?.textContent,deliveryNote:document.getElementById('delivery-note')?.textContent,degradedTag:/预写/.test(document.getElementById('generation-status')?.textContent||''),offlineBanner:/连接设置/.test(document.getElementById('connection-status')?.textContent||'')});
})()`;

async function main(): Promise<void> {
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
    { stdio: 'ignore' },
  );

  let browserWsUrl = '';
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      const j = (await r.json()) as { webSocketDebuggerUrl?: string };
      if (j.webSocketDebuggerUrl) {
        browserWsUrl = j.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  if (!browserWsUrl) {
    chrome.kill();
    console.error('❌ Chrome 调试端口未就绪');
    process.exit(1);
  }

  const ws = new WebSocket(browserWsUrl, { maxPayload: 64 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let nextId = 1;
  const pending = new Map<number, (v: unknown) => void>();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as { id?: number; result?: unknown };
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result);
      pending.delete(msg.id);
    }
  });

  const command = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => {
    const id = nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify(payload));
    });
  };

  const target = (await command('Target.createTarget', { url: 'about:blank' })) as { targetId: string };
  const attached = (await command('Target.attachToTarget', { targetId: target.targetId, flatten: true })) as {
    sessionId: string;
  };
  const sessionId = attached.sessionId;
  await command('Page.enable', {}, sessionId);
  if (testKey) {
    await command(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: `try{localStorage.setItem('rnt.apiKey', ${JSON.stringify(testKey)});localStorage.setItem('rnt.settingsSeen','1');}catch(e){}` },
      sessionId,
    );
    console.log('  → 已在页面注入 API Key（localStorage）');
  }
  await command('Page.navigate', { url }, sessionId);

  console.log(`浏览器检查：${url}`);
  const started = Date.now();
  let last = '';
  let done = false;
  let clickedSimulate = false;
  let submitted = false;
  let seenEncapsulating = false;

  while (Date.now() - started < waitMs) {
    await sleep(1500);
    const res = (await command('Runtime.evaluate', { expression: PROBE, returnByValue: true }, sessionId)) as {
      result?: { value?: string };
    };
    const raw = res?.result?.value;
    if (!raw) continue;
    const state = JSON.parse(raw) as Record<string, any>;
    last = raw;
    if (state.phase === 'encapsulating') seenEncapsulating = true;

    const sample = new URL(url).searchParams.get('autostart') || '如果我辞职去大理开咖啡店';
    if (submitted && state.views.input === 'visible' && /待设置模型/.test(state.statusText || '')) break;
    let action = '';
    if (state.views.home === 'visible') action = "document.getElementById('bottle').click()";
    else if (state.views.pill === 'visible') action = "document.getElementById('pill').click()";
    else if (state.views.input === 'visible' && state.demoChoice === 'visible' && allowDemo) action = "document.getElementById('demo-choice').click()";
    else if (state.views.input === 'visible' && !submitted) { submitted = true; action = `document.getElementById('regret').value=${JSON.stringify(sample)};document.getElementById('regret-form').requestSubmit()`; }
    else if (state.views.story === 'visible') action = "document.getElementById('next').click()";
    else if (state.views.envelope === 'visible') action = "document.getElementById('open-letter').click()";
    else if (state.views.letter === 'visible') action = "document.getElementById('view-receipt').click()";
    if (action) await command('Runtime.evaluate', { expression: action }, sessionId);
    if (state.views.result === 'visible') {
      done = true;
      break;
    }
    // 无硬件时流程停在"等待动作"，点演示按钮把流程推完（与真机同一状态机）
    if (!clickedSimulate && state.views.waiting === 'visible') {
      clickedSimulate = true;
      await command(
        'Runtime.evaluate',
        { expression: `document.getElementById('simulate').click()` },
        sessionId,
      );
      console.log('  → 已点击「我完成了翻转（演示）」');
    }
  }

  const state = JSON.parse(last || '{}') as Record<string, any>;
  console.log(`\n=== 结果（${((Date.now() - started) / 1000).toFixed(1)}s，${done ? '已出票' : '超时未完成'}）===`);
  console.log(JSON.stringify(state, null, 2));

  const noKeyFlow = state.views.input === 'visible' && /待设置模型/.test(state.statusText || '');
  const ok =
    state.offlineBanner === false &&
    (noKeyFlow ||
      (state.views.result === 'visible' &&
        state.actLabels === 3 &&
        (allowDemo ? state.degradedTag === true && seenEncapsulating &&
          /模拟体验/.test(state.deliveryNote) : state.degradedTag === false) &&
        state.hasQr === true));
  console.log(
    `\n${
      ok
        ? noKeyFlow
          ? '✅ 无 Key 时保留输入并提示设置（预期行为）'
          : allowDemo ? '✅ 浏览器模拟胶囊流程通过（含封装阶段）'
            : '✅ 浏览器端到端通过（真实模型生成 + 二维码）'
        : '❌ 未通过'
    }`,
  );

  await command('Target.closeTarget', { targetId: target.targetId });
  ws.close();
  chrome.kill();
  process.exit(ok ? 0 : 1);
}

void main();
