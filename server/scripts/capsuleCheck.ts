/** 内部协议回归测试：服务端需用 MOCK_LLM=1 启动，不能代替真机机械验证。 */
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

const port = Number(process.env.PORT ?? 8787);
const base = `http://127.0.0.1:${port}/api`;
const ws = new WebSocket(`ws://127.0.0.1:${port}/device?deviceId=regression-capsule`);
const messages: any[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function api(path: string, body?: unknown): Promise<{ status: number; value: any }> {
  const r = await fetch(base + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, value: await r.json() };
}
async function until<T>(probe: () => T | undefined, label: string, ms = 15000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const result = probe();
    if (result !== undefined) return result;
    await sleep(50);
  }
  throw new Error(`等待超时：${label}`);
}
async function waitState(id: string, expected: string): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    const s = (await api(`/sessions/${id}`)).value;
    if (s.state === expected) return s;
    if (s.state === 'error') throw new Error(`意外进入错误状态：${s.error}`);
    await sleep(80);
  }
  throw new Error(`等待 ${expected} 超时`);
}
async function send(msg: unknown): Promise<void> {
  ws.send(JSON.stringify(msg));
  await sleep(80);
}
async function main(): Promise<void> {
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await send({ type: 'hello', deviceId: 'regression-capsule', firmware: 'test', capabilities: { capsule: true } });
  const rogue = new WebSocket(`ws://127.0.0.1:${port}/device?deviceId=regression-capsule`);
  await new Promise<void>((resolve, reject) => { rogue.once('open', resolve); rogue.once('error', reject); });
  rogue.send(JSON.stringify({ type: 'hello', deviceId: 'regression-capsule', capabilities: { capsule: true } }));
  const created = (await api('/sessions', {})).value;
  const id = created.sessionId as string;
  await api(`/sessions/${id}/generate`, { text: '如果我辞职去大理开咖啡店' });
  assert.equal((await api(`/sessions/${id}/generate`, { text: '如果我又提交了一次' })).status, 409);
  const ready = await waitState(id, 'await_action');
  assert.equal(ready.delivery, 'capsule');
  assert.equal(ready.input, undefined, '公开视图不返回输入原文');
  const task = await until(() => messages.find((m) => m.type === 'task' && m.sessionId === id), 'task');
  assert.equal(task.delivery, 'capsule');
  assert.ok(Buffer.from(task.receiptBase64, 'base64').length < 5000, '胶囊内芯不含三张插图/二维码');
  const action = await until(() => messages.find((m) => m.type === 'action_required' && m.sessionId === id), 'action');
  await send({ type: 'capsule_dispensed', sessionId: id, deviceId: 'regression-capsule', paperCaptured: true, capsuleClosed: true, outletClear: true });
  await send({ type: 'print_done', sessionId: id, deviceId: 'regression-capsule' });
  await send({ type: 'action_complete', sessionId: id, deviceId: 'regression-capsule' });
  assert.equal((await api(`/sessions/${id}`)).value.state, 'await_action', '提前完成消息不能越过动作门控');
  await send({ type: 'action_progress', sessionId: id, done: action.moves.length, total: action.moves.length });
  await send({ type: 'action_complete', sessionId: id, deviceId: 'regression-capsule' });
  await until(() => messages.find((m) => m.type === 'print_authorized' && m.sessionId === id), 'print_authorized');
  assert.equal((await api(`/sessions/${id}`)).value.state, 'printing');
  await send({ type: 'print_done', sessionId: id, deviceId: 'regression-capsule' });
  await waitState(id, 'encapsulating');
  await until(() => messages.find((m) => m.type === 'capsule_authorized' && m.sessionId === id), 'capsule_authorized');
  rogue.send(JSON.stringify({ type: 'capsule_dispensed', sessionId: id, deviceId: 'regression-capsule',
    paperCaptured: true, capsuleClosed: true, outletClear: true }));
  await sleep(80);
  assert.equal((await api(`/sessions/${id}`)).value.state, 'encapsulating', '同名其他连接不能接管任务');
  await send({ type: 'capsule_dispensed', sessionId: id, deviceId: 'regression-capsule', paperCaptured: true, capsuleClosed: false, outletClear: true });
  assert.equal((await api(`/sessions/${id}`)).value.state, 'encapsulating', '未闭盖不能报完成');
  await send({ type: 'capsule_dispensed', sessionId: id, deviceId: 'regression-capsule', paperCaptured: true, capsuleClosed: true, outletClear: true });
  await waitState(id, 'done');
  rogue.close();

  await send({ type: 'state', state: 'idle', deviceId: 'regression-capsule' });
  const crisis = (await api('/sessions', {})).value.sessionId as string;
  await api(`/sessions/${crisis}/generate`, { text: '想死' });
  const care = await waitState(crisis, 'done');
  assert.equal(care.kind, 'care');
  assert.equal(care.delivery, undefined);
  assert.equal(care.shareUrl, undefined);
  assert.equal(messages.some((m) => m.type === 'task' && m.sessionId === crisis), false, '危机输入不下发设备');
  assert.equal((await fetch(`${base}/sessions/${crisis}/qr.png`)).status, 404);

  const fault = (await api('/sessions', {})).value.sessionId as string;
  await api(`/sessions/${fault}/generate`, { text: '如果我大学选择了另一座城市的工作' });
  await waitState(fault, 'await_action');
  const a2 = await until(() => messages.find((m) => m.type === 'action_required' && m.sessionId === fault), 'fault action');
  await send({ type: 'action_progress', sessionId: fault, done: a2.moves.length, total: a2.moves.length });
  await send({ type: 'action_complete', sessionId: fault, deviceId: 'regression-capsule' });
  await until(() => messages.find((m) => m.type === 'print_authorized' && m.sessionId === fault), 'fault authorization');
  await send({ type: 'print_done', sessionId: fault, deviceId: 'regression-capsule' });
  await waitState(fault, 'encapsulating');
  await send({ type: 'error', sessionId: fault, deviceId: 'regression-capsule', code: 'feed_jam' });
  assert.equal((await api(`/sessions/${fault}`)).value.state, 'error');
  await send({ type: 'capsule_dispensed', sessionId: fault, deviceId: 'regression-capsule', paperCaptured: true, capsuleClosed: true, outletClear: true });
  assert.equal((await api(`/sessions/${fault}`)).value.state, 'error', '迟到的 ACK 不复活失败任务');
  console.log('✅ 胶囊正向/越权/危机/卡纸回归通过（仅软件模拟）');
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => ws.close());
