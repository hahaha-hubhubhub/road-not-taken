import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { config, WEB_DIR } from './config.js';
import { gateway } from './device/gateway.js';
import { sessionStore } from './sessions/store.js';
import { wireBus } from './sessions/service.js';
import { apiRouter } from './sessions/routes.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

/* 跨域：静态托管的前端（steppage 等）需要访问本地服务 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowList = config.allowedOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  const allowOrigin =
    config.allowedOrigin === '*' ? '*' : origin && allowList.includes(origin) ? origin : '';
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Stepfun-Api-Key, X-Stepfun-Model');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use('/api', apiRouter);

/* 请求日志（排查前端联调用） */
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(
      `[http] ${req.method} ${req.path} → ${res.statusCode} ${res.getHeader('content-type') ?? ''} (${Date.now() - start}ms)`,
    );
  });
  next();
});

if (fs.existsSync(WEB_DIR)) {
  app.use(
    express.static(WEB_DIR, {
      index: 'index.html',
      setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
    }),
  );
} else {
  app.use('/', (_req, res) => res.status(503).send('web/ 目录缺失'));
}

/**
 * 手机传感器只在安全上下文可用；手机走局域网 IP 时必须有 HTTPS。
 * 这里用 openssl 生成一张自签证书（含局域网 IP 的 SAN），只为了把页面变成安全上下文。
 */
function selfSigned(): { key: Buffer; cert: Buffer } | null {
  const dir = config.tlsDir;
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  try {
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      fs.mkdirSync(dir, { recursive: true });
      const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');
      const base = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
        '-keyout', keyPath, '-out', certPath, '-subj', '/CN=road-not-taken'];
      try {
        execFileSync('openssl', [...base, '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
      } catch {
        // 老版本 openssl 不认 -addext，退化成不带 SAN 的证书：手机会多一次警告点继续
        execFileSync('openssl', base, { stdio: 'ignore' });
      }
      console.log(`  · 已生成自签证书：${dir}`);
    }
    return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
  } catch (err) {
    console.warn(`  · HTTPS 不可用（${err instanceof Error ? err.message : String(err)}），退回 HTTP。`);
    return null;
  }
}

const tls = config.https ? selfSigned() : null;
const server = tls ? https.createServer(tls, app) : http.createServer(app);
const scheme = tls ? 'https' : 'http';
const wsScheme = tls ? 'wss' : 'ws';
gateway.attach(server);
wireBus();

/** 数据保留策略（OPS-03） */
setInterval(
  () => {
    const removed = sessionStore.purge();
    if (removed > 0) console.log(`[store] 已清除 ${removed} 个过期 session`);
  },
  10 * 60 * 1000,
);

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

server.listen(config.port, () => {
  const model = config.mockLlm ? 'mock（未配置密钥 / MOCK_LLM=1）' : config.stepfun.model;
  console.log('');
  console.log('  没走的路 / Road Not Taken — 服务端已启动');
  console.log(`  · 模型：${model}`);
  console.log(`  · 本机：${scheme}://localhost:${config.port}`);
  for (const ip of lanAddresses()) {
    console.log(`  · 局域网（手机扫码/访问用）：${scheme}://${ip}:${config.port}`);
  }
  console.log(`  · 设备通道：${wsScheme}://<地址>:${config.port}/device?deviceId=mock-01`);
  if (tls) {
    console.log('  · 手机动作已可用：自签证书会让手机先弹一次「不安全」，点「继续访问」即可。');
    console.log('    想彻底不警告：把 server/.certs/cert.pem 装到手机上设为信任。');
  } else if (lanAddresses().length) {
    console.log('  · 注意：手机走局域网 http 时，浏览器会禁用陀螺仪 / 加速度计 / 麦克风。');
    console.log('    要用「翻个面 / 摇一摇 / 吹一口气」，请用 HTTPS=1 重启（见 README「手机传感器」）。');
  }
  console.log('  · 模拟设备：npm run mock-device');
  console.log('');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log('\n[server] 正在关闭…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  });
}
