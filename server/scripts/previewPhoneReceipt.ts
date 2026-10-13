/**
 * 用真实 session 数据渲染一份手机端小票预览（含 gpt-image-2 生成图）。
 * 不起浏览器、不依赖真机，用于快速看效果。
 *
 *   npx tsx scripts/previewPhoneReceipt.ts [sessionId]
 *
 * 不带 sessionId 时取最近一个 imageStatus=ready 的会话。
 */

import fs from 'node:fs';
import path from 'node:path';

const API = process.env.PREVIEW_API ?? 'http://127.0.0.1:8787';
const OUT = process.env.PREVIEW_OUT ?? '/tmp/phone-receipt.html';

const esc = (t: unknown): string =>
  String(t ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

const CN = ['一', '二', '三'];

async function pickSession(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;
  const r = await fetch(`${API}/api/demo/cases`);
  if (!r.ok) throw new Error('无法连接服务端，请先 npm start');
  throw new Error('请传入 sessionId：npm run preview-phone -- <sessionId>');
}

async function main(): Promise<void> {
  const sid = await pickSession();
  const r = await fetch(`${API}/api/sessions/${sid}`);
  if (!r.ok) throw new Error(`session ${sid} 不存在或已过期（HTTP ${r.status}）`);
  const s = (await r.json()) as {
    title?: string;
    ending?: string;
    disclaimer?: string;
    acts?: { index: number; name: string; caption: string }[];
    imageStatus?: string;
    imageReadyActs?: number[];
  };

  const acts = (s.acts ?? [])
    .map((a) => {
      const ready = s.imageStatus === 'ready' && (s.imageReadyActs ?? []).includes(a.index);
      const src = ready ? `${API}/api/sessions/${sid}/images/${a.index}` : `img/act-${a.index}.png`;
      return (
        `<div class="act"><div class="act-label">第${CN[a.index - 1] ?? a.index}幕 · ${esc(a.name)}</div>` +
        `<img src="${src}" alt="第${a.index}幕"><p>${esc(a.caption)}</p></div>`
      );
    })
    .join('<div class="dashed"></div>');

  const d = new Date();
  const meta = `RNT-${sid.slice(0, 6).toUpperCase()} · ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>小票预览 — ${esc(s.title)}</title><style>
body{margin:0;padding:28px 14px;background:#e8e6e1;display:flex;flex-direction:column;align-items:center;
     font-family:"PingFang SC","Hiragino Sans GB",monospace}
.receipt{background:#fff;color:#000;padding:26px 20px;width:340px;box-shadow:0 2px 14px rgba(0,0,0,.18)}
.receipt-title{font-family:Georgia,serif;font-size:21px;font-weight:700;text-align:center}
.receipt-meta{font-size:11px;color:#666;text-align:center;margin:6px 0 12px;font-family:ui-monospace,monospace}
.dashed{border-top:1px dashed #999;margin:14px 0}
.act-label{font-size:13px;font-weight:700;margin-bottom:8px}
.act img{width:100%;display:block}
.act p{font-size:13.5px;line-height:1.65;margin:10px 0 0;white-space:pre-wrap}
.ending{text-align:center;font-weight:700;font-size:15px;font-family:Georgia,serif}
.foot{font-size:10.5px;color:#666;text-align:center;margin-top:12px;line-height:1.6}
</style></head><body><div class="receipt">
<div class="receipt-title">${esc(s.title)}</div><div class="receipt-meta">${meta}</div><div class="dashed"></div>
${acts}
<div class="dashed"></div><div class="ending">${esc(s.ending)}</div>
<div class="dashed"></div><div class="foot">${esc(s.disclaimer)}</div>
</div></body></html>`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`已生成 ${OUT}`);
  console.log(`标题：${s.title}`);
  console.log(`图片状态：${s.imageStatus}，就绪幕次 ${JSON.stringify(s.imageReadyActs ?? [])}`);
}

main().catch((err) => {
  console.error('失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
