/**
 * 端到端冒烟测试（本地验证用）。
 *
 * 前置：服务端已在运行（npm start / npm run dev）。
 *   npm run smoke                      # 演示模式 + 模拟设备 两条路径都测
 *   npm run smoke -- --no-device       # 只测演示模式（不调模型时可离线跑）
 *   npm run smoke -- --input="如果我当时……"
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(here, '..');
const PORT = Number(process.env.PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}/api`;
const useDevice = !process.argv.includes('--no-device');
const input =
  process.argv.find((a) => a.startsWith('--input='))?.slice('--input='.length) ??
  '如果我当时辞职去大理开咖啡店';

/** Key 来源与浏览器一致：环境变量 > 仓库 .env；没有就走"未配置 Key"分支 */
function readKeyFromEnvFile(): string {
  for (const p of [path.resolve(SERVER_DIR, '..', '.env'), path.resolve(SERVER_DIR, '.env')]) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/^STEPFUN_API_KEY\s*=\s*(.+)$/m);
      if (m && m[1].trim()) return m[1].trim();
    } catch {
      /* 文件不存在 */
    }
  }
  return '';
}
const API_KEY = (process.env.STEPFUN_API_KEY ?? '').trim() || readKeyFromEnvFile();

let failures = 0;
let mockLlm = false;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function get<T>(p: string): Promise<T> {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`GET ${p} → ${r.status}`);
  return (await r.json()) as T;
}

async function post<T>(p: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + p, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'X-Stepfun-Api-Key': API_KEY } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await r.json().catch(() => ({}))) as T;
  if (!r.ok) throw new Error(`POST ${p} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

interface SessionView {
  sessionId: string;
  state: string;
  title?: string;
  acts?: { index: number; name: string; caption: string; imagePrompt: string }[];
  ending?: string;
  disclaimer?: string;
  action?: { text: string; done: number; total: number };
  error?: string;
  degraded?: boolean;
  kind?: string;
  generateMs?: number;
  deviceConnected?: boolean;
  delivery?: 'capsule' | 'receipt' | 'demo';
}

async function waitState(id: string, targets: string[], timeoutMs: number): Promise<SessionView> {
  const started = Date.now();
  let last: SessionView | null = null;
  while (Date.now() - started < timeoutMs) {
    last = await get<SessionView>(`/sessions/${id}`);
    if (targets.includes(last.state)) return last;
    if (last.state === 'error') throw new Error(`session 进入错误状态：${last.error ?? '未知'}`);
    await sleep(400);
  }
  throw new Error(`等待 ${targets.join('/')} 超时（最后状态：${last?.state ?? '无'}）`);
}

function spawnMockDevice(): ChildProcess {
  const tsx = path.join(SERVER_DIR, 'node_modules', '.bin', 'tsx');
  return spawn(tsx, ['src/device/mockDevice.ts', '--port', String(PORT)], {
    cwd: SERVER_DIR,
    stdio: 'ignore',
  });
}

async function waitForDevice(timeoutMs = 25000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await get<{ connected: boolean }>('/device/status');
    if (status.connected) return true;
    await sleep(500);
  }
  return false;
}

async function runFlow(label: string, expectDevice: boolean): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const created = await post<SessionView>('/sessions');
  check('创建 session', Boolean(created.sessionId), created.sessionId);

  await post(`/sessions/${created.sessionId}/generate`, { text: input });
  const ready = await waitState(created.sessionId, ['await_action', 'done', 'error'], 150000);

  if (ready.state === 'error' && /API Key/i.test(ready.error ?? '')) {
    check('未配置 Key 时给出明确提示（不静默降级）', true, ready.error);
    return;
  }
  if (ready.state !== 'await_action') {
    check('进入等待动作状态', false, `state=${ready.state} error=${ready.error ?? ''}`);
    return;
  }

  check(
    mockLlm ? '显式 MOCK_LLM 演示案例（三幕）' : API_KEY ? '请求头带 Key 生成三幕结果' : '生成三幕结果',
    (ready.acts?.length ?? 0) === 3,
    `kind=${ready.kind} ${ready.generateMs ?? 0}ms${ready.degraded ? '（已降级）' : ''}`,
  );
  check('标题/结尾/免责声明齐全', Boolean(ready.title && ready.ending && ready.disclaimer), ready.title ?? '');
  check('动作指令已生成', Boolean(ready.action?.text), ready.action?.text ?? '');
  check(
    expectDevice ? '设备在线' : '无设备时仍可继续（演示模式）',
    expectDevice ? Boolean(ready.deviceConnected) : true,
    `deviceConnected=${ready.deviceConnected}`,
  );

  if (expectDevice) {
    const done = await waitState(created.sessionId, ['done'], 40000);
    check('模拟设备驱动到胶囊出仓完成', done.state === 'done' && done.delivery === 'capsule',
      `delivery=${done.delivery} action=${done.action?.done}/${done.action?.total}`);
  } else {
    await post(`/sessions/${created.sessionId}/simulate-action`);
    const done = await waitState(created.sessionId, ['done'], 30000);
    check('演示模式模拟打印+封装到完成', done.state === 'done' && done.delivery === 'demo');
  }

  const result = await get<SessionView>(`/sessions/${created.sessionId}/result`);
  check('结果接口可读取', (result.acts?.length ?? 0) === 3);
}

async function main(): Promise<void> {
  console.log(`冒烟测试目标：${BASE}`);
  console.log(`Key 来源：${API_KEY ? '环境变量 / .env（将随请求头发送）' : '未配置（预期走到"未配置 Key"提示）'}`);
  const health = await get<{ ok: boolean; model: string; mockLlm: boolean }>('/health').catch((err) => {
    console.error(`❌ 服务端未启动：${err.message}\n请先运行 npm start（server 目录）`);
    process.exit(2);
  });
  mockLlm = health.mockLlm;
  console.log(`服务端正常，模型：${mockLlm ? 'MOCK_LLM 演示' : health.model}`);

  await runFlow('路径 A：无硬件（演示模式）', false);

  if (useDevice) {
    const child = spawnMockDevice();
    try {
      const connected = await waitForDevice();
      check('模拟设备接入', connected);
      if (connected) await runFlow('路径 B：真实 WS 设备通道（模拟设备）', true);
    } finally {
      child.kill();
    }
  }

  console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
