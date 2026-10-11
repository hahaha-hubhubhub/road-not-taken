import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
      `[http] ${req.method} ${req.originalUrl} → ${res.statusCode} ${res.getHeader('content-type') ?? ''} (${Date.now() - start}ms)`,
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

const server = http.createServer(app);
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
  console.log(`  · 本机：http://localhost:${config.port}`);
  for (const ip of lanAddresses()) {
    console.log(`  · 局域网（手机扫码/访问用）：http://${ip}:${config.port}`);
  }
  console.log(`  · 设备通道：ws://<地址>:${config.port}/device?deviceId=mock-01`);
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
