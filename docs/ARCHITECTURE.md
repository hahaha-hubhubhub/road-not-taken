# 《没走的路》软件架构与接口契约

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.2 |
| 对应 PRD | v0.1 |
| 状态 | 阶段一（闭环优先）已完成并通过本地验证；硬件未采购，接口契约已定义并由模拟设备验证 |

---

## 1. 总体架构

```text
手机浏览器（web/，纯静态，可托管）
   │  POST /api/sessions            创建 session
   │  POST /api/sessions/:id/generate  提交"如果当时……"
   │  GET  /api/sessions/:id        轮询状态（1.2s）
   ▼
应用服务（server/，Node + TypeScript）
   ├── LLM 层：StepFun step-5-preview，JSON Schema 严格结构化输出
   │      三幕故事 + 三张画面提示词 + 结尾短句
   ├── 会话状态机：created → generating → await_action → printing → done / error
   ├── 打印排版：PNG → 1-bit 抖动 → ESC/POS 字节流（含二维码）
   └── 设备网关：WebSocket /device
            │  task / action_required / print_authorized / cancel
            ▼
       实体设备（树莓派 + IMU + LED + 58mm 热敏打印机）
            未到位期间由 `npm run mock-device` 模拟，行为与真机一致
```

设计原则（沿用 PRD 第 11 节）：**服务端完成全部排版与位图转换，硬件只负责状态机、传感器和打印**，把联调复杂度留在软件侧。

---

## 2. 目录结构

```text
road-not-taken/
├── README.md                 产品说明 + 快速开始
├── AGENTS.md                 Agent 协作与提交流程（仓库原有约定）
├── .env.example              环境变量模板（复制为 .env，已被 gitignore）
├── docs/
│   ├── PRD.md                产品需求文档 v0.1
│   ├── ARCHITECTURE.md       本文档
│   └── PROGRESS.md           进度记录与验证数据
├── assets/presets/           预置插画（MVP 打印用，384x384 黑白线描）
├── server/
│   ├── src/
│   │   ├── config.ts         环境变量与全局配置
│   │   ├── bus.ts            模块间事件总线（service ↔ device gateway）
│   │   ├── llm/
│   │   │   ├── prompt.ts     System Prompt + few-shot + 内容边界
│   │   │   ├── schema.ts     JSON Schema（json_schema strict）+ zod 校验
│   │   │   ├── generate.ts   生成编排：安全 → LLM → 校验 → 重试 → 降级
│   │   │   ├── safety.ts     输入/输出安全过滤、心理危机安抚文案
│   │   │   └── demoCases.ts  预生成演示案例
│   │   ├── sessions/
│   │   │   ├── store.ts      session 存储（内存 + 24h TTL）+ 随机动作指令
│   │   │   ├── service.ts    状态机与流程编排
│   │   │   └── routes.ts     REST API
│   │   └── device/
│   │       ├── protocol.ts   设备通信协议（类型即契约）
│   │       ├── gateway.ts    WebSocket 网关 + 打印门控
│   │       ├── escpos.ts     PNG → 1-bit → ESC/POS、二维码、小票排版
│   │       ├── mockDevice.ts 模拟设备（CLI）
│   │       └── img2bit.ts    图片转位图调试工具
│   └── scripts/              smoke（端到端测试）、tryLlm（prompt 调试）、
│                             makePresetImages（生成预置插画）、previewReceipt
└── web/                      手机端静态页面（无构建、无依赖）
    ├── index.html  styles.css  app.js
    └── img/act-1..3.png
```

---

## 3. 本地运行

```bash
# 1. 配置密钥（仓库根目录）
cp .env.example .env
#    编辑 .env 填入 STEPFUN_API_KEY（本机在 ~/.dsh/.credentials.yaml 的 refs.STEPFUN_API_KEY）

# 2. 启动服务端（默认 8787）
cd server && npm install && npm start

# 3.（可选）启动模拟设备，验证真实设备通道
cd server && npm run mock-device

# 4. 端到端测试
cd server && npm run smoke
```

- 手机访问：启动日志里会打印局域网地址，如 `http://10.104.163.210:8787`。
- 没有密钥时：`.env` 不填 `STEPFUN_API_KEY`（或 `MOCK_LLM=1`）即可用预生成案例跑通全流程。
- 常用调试：`npm run try-llm -- "输入" medium 4000`（直接看模型原始输出与耗时）、
  `npm run receipt-preview -- out/receipt-xxx.bin`（预览小票字节流）。

---

## 4. REST API

基地址：`http://<host>:8787/api`。跨域已放开（`ALLOWED_ORIGIN`，默认 `*`），
静态托管的前端可通过 `?api=http://<局域网IP>:8787` 指定后端。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查，返回当前模型 |
| GET | `/demo/cases` | 预生成演示案例（断网时前端可展示） |
| GET | `/device/status` | 是否有实体设备在线 |
| POST | `/sessions` | 创建 session，返回 `sessionId` |
| POST | `/sessions/:id/generate` | body `{text}`，返回 202，异步生成 |
| GET | `/sessions/:id` | 轮询 session 状态与结果 |
| GET | `/sessions/:id/result` | 分享页/结果页数据 |
| GET | `/sessions/:id/qr.png` | 分享二维码 PNG（480px） |
| POST | `/sessions/:id/simulate-action` | **演示模式**：无硬件时模拟完成翻转动作 |
| POST | `/sessions/:id/cancel` | 取消当前 session |

`GET /sessions/:id` 返回的关键字段：

```json
{
  "sessionId": "9IkCQWkX",
  "state": "await_action",
  "title": "另一条路：大理开店",
  "acts": [
    { "index": 1, "name": "滤镜", "hint": "那条路最诱人的样子",
      "caption": "……", "imagePrompt": "黑白线描：……", "imageUrl": "/img/act-1.png" }
  ],
  "ending": "另一条路也有风景，也要交房租。",
  "disclaimer": "这是模型生成的虚构故事，不是人生预测。",
  "action": { "text": "向左翻 1 次，再向右翻 2 次", "moves": ["L","R","R"], "done": 0, "total": 3 },
  "kind": "story",
  "degraded": false,
  "deviceConnected": true,
  "shareUrl": "http://localhost:8787/#/r/9IkCQWkX",
  "generateMs": 29285
}
```

`state` 取值：`created` / `generating` / `await_action` / `printing` / `done` / `error`。
`kind` 取值：`story`（模型生成）/ `care`（心理危机安抚）/ `demo`（降级到预生成案例）。

错误约定：输入不合规返回 400 + `{error}`；session 不存在返回 404；
状态不允许返回 409 + `{error, state}`。

---

## 5. 设备通信协议（WebSocket `/device`）

连接：`ws://<host>:8787/device?deviceId=mock-01`

### 5.1 服务端 → 设备

| type | 字段 | 说明 |
| --- | --- | --- |
| `welcome` | `deviceId`, `serverTime` | 握手应答 |
| `task` | `sessionId`, `title`, `scenes[]`, `ending`, `disclaimer`, `shareUrl`, `widthPx`, `receiptBase64` | **`receiptBase64` 是整张小票的 ESC/POS 字节流（base64），设备解码后直接写入打印机** |
| `action_required` | `sessionId`, `moves`(`["L","R",…]`), `text` | 翻转指令 |
| `print_authorized` | `sessionId` | 打印授权（只有动作完成后才下发） |
| `cancel` | `sessionId`, `reason` | 取消任务 |

### 5.2 设备 → 服务端

| type | 字段 | 说明 |
| --- | --- | --- |
| `hello` | `deviceId`, `firmware` | 上线注册 |
| `state` | `deviceId`, `state`, `sessionId?` | 设备状态（idle/generating/await_action/printing/done/error） |
| `action_progress` | `sessionId`, `done`, `total` | 动作进度（驱动手机端圆点） |
| `action_complete` | `sessionId`, `deviceId` | 动作完成 → 服务端进入 printing 并授权 |
| `print_started` | `sessionId`, `deviceId` | 开始打印（未授权会被拦截并记 error） |
| `print_done` | `sessionId`, `deviceId` | 打印完成 → 服务端置 done |
| `error` | `deviceId`, `code`, `message?`, `sessionId?` | `paper_out`/`paper_jam`/`imu`/`printer`/`unauthorized_print` |
| `button` | `deviceId`, `button`(`retry`/`cancel`), `sessionId?` | 实体按钮 |

### 5.3 打印门控（PRD MVP 验收 3）

```
动作未完成 → 服务端不下发 print_authorized
设备未收到 print_authorized 就发送 print_started → 服务端拦截并上报 unauthorized_print
```

### 5.4 硬件接入待办（采购后）

1. 用 `protocol.ts` 的类型生成固件侧消息结构（Python/Arduino 均可）；
2. `receiptBase64` 直接写串口/USB；**建议 115200 以上波特率或 USB**——实测含三张插画的小票约 73KB，9600 波特率下传输需 60 秒以上；
3. IMU 只做"翻面计数"（加速度 z 轴符号变化 + 阈值去抖），不做复杂手势；
4. 缺纸/卡纸用 `error` 上报，服务端会把 session 置为 error 并提示工作人员。

---

## 6. LLM 层设计

### 6.1 结构化输出

- 模型：`step-5-preview`（StepFun，OpenAI 兼容，`https://api.stepfun.com/v1`）。
- 方式：`response_format: {"type":"json_schema","json_schema":{"name":"road_not_taken_story","strict":true,"schema":…}}`。
  这是 **API 层强制约束**，比把 Schema 写进 prompt 的 JSON Mode 稳定得多。
- 服务端仍用 zod 二次校验（三幕数量、字数、空值），不通过则把错误反馈给模型重试。

Schema 结构：`title` / `scenes[3]{caption, image_prompt}` / `ending` / `disclaimer`。
三幕顺序固定为 滤镜 → 代价 → 意外，**标签由服务端渲染**，模型只写正文，降低漂移。

### 6.2 Prompt 结构（`llm/prompt.ts`）

角色定位 → 输出要求 → 三幕结构 → 写法要求（具体细节、字数上限）→ 内容边界 → few-shot 示例
（示例直接采用 PRD 里的"大理咖啡店"案例，保证线上线下体验一致）。

### 6.3 推理强度与延迟（实测数据）

`step-5-preview` 的**思考过程计入 completion_tokens**，因此 `max_tokens` 必须留够
（实测思考 1000–2500 tokens + 正文约 500；`max_tokens=1600` 会出现"正文被截断/内容为空"）。

| 配置 | 实测耗时 | 说明 |
| --- | --- | --- |
| `reasoning_effort=medium`, `max_tokens=8000` | **21–34s** | 当前默认，内容质量最好 |
| `reasoning_effort=low`, `max_tokens=4000` | 28–41s | 未必更快 |
| `reasoning_effort=high`, `max_tokens=4000` | 约 39s | 不必要 |
| `step-3.7-flash`（改一个环境变量即可切换） | 10–16s | 现场若必须压到 15 秒内 |

`max_tokens` 默认 8000 是因为**思考过程计入 completion_tokens**：1600 会让正文被截断甚至返回空内容，
4000 偶发仍不够（实测一次思考 3500+ tokens）。被截断时服务端会自动加额 1.5 倍重试（上限 12000）。

PRD AI-05 目标 30 秒：`medium` 下基本达标；若现场网络差，用
`STEPFUN_MODEL=step-3.7-flash` 降级。

### 6.4 降级与安全

- 断网/超时 → **立即**切换预生成演示案例（不重试，保证演示不中断）；
- 校验失败 → 最多重试 1 次（带错误反馈）；
- 仍失败 → 演示案例，并在结果上标注"演示案例"；
- 输入安全：过短/含禁止内容 → 400；涉及自伤或心理危机 → 返回固定安抚文案
  （`kind=care`，含心理援助热线），**不生成黑色幽默**；
- 输出安全：命中"死亡/重病/残疾/贫困当笑点"等模式视为失败，重试或降级；
- 所有结果的免责声明由服务端统一覆盖为"这是模型生成的虚构故事，不是人生预测。"

---

## 7. 热敏打印管线

```text
PNG(384x384 线描) → 灰度 + 双线性缩放到 384 点宽 → Floyd–Steinberg 抖动
   → 1-bit 位打包（bit=1 为黑点）→ GS v 0 光栅指令
文本 → GBK 编码（iconv-lite）→ ESC/POS 文本指令
分享链接 → qrcode 生成矩阵 → 位图 → GS v 0
```

小票排版顺序：标题（居中加粗）→ 虚线 → 三幕（标签 + 折行正文 + 插画，幕间虚线）
→ 虚线 → 结尾（居中加粗）→ 免责声明 → 二维码 → 走纸。
正文按 24 全角字/行折行（384 点 ÷ 16 点每字）。

调试工具：`npm run img2bit -- <png> --ascii`、`npm run receipt-preview -- <bin>`。

浏览器联调：`npm run browser-check -- "<url>?autostart=如果当时我……" 150000`
（基于 Chrome DevTools Protocol，会等生成完成后自动点掉演示按钮并断言结果；
不要用 `--dump-dom`，它等不到异步生成）。

**已知限制**：插画目前用 `assets/presets/` 预置线描（PRD §13 允许的降级方案）；
接入图片模型后，把 `presetImageBitmap()` 换成按 session 出图即可，其余链路不变。

---

## 8. 前端（web/）

- 纯静态、零依赖、零构建，可直接托管（steppage / 任意静态服务器）。
- 视图：输入 → 生成中 → 等待动作 → 打印中 → 结果（小票样式）。
- 有设备在线：显示翻转指令与进度圆点，等待设备驱动；
  无设备：显示"我完成了翻转（演示）"按钮，走 `simulate-action`（与真机同一状态机和门控）。
- 保存长图：canvas 重绘小票（含二维码）→ 下载 PNG。
- 分享：`#/r/<sessionId>` 路由打开结果页；二维码由服务端生成，指向同一地址。
- 语音输入：优先 Web Speech API，失败提示改用键盘（WEB-02）。
- 后端不可达时自动进入演示模式（内置 4 个预生成案例），可通过
  `?api=<地址>` 或页脚"连接本地服务"切换后端。

---

## 9. 已知问题与下一步

| 事项 | 状态 |
| --- | --- |
| 阶段一软件闭环 | ✅ 完成并验证 |
| 硬件协议 + 模拟设备 | ✅ 契约定义并跑通 |
| 图片生成（AI-03） | ⏳ 用预置插画降级，接入点已留好 |
| 硬件采购与固件 | ⏳ 待采购（见 PROGRESS.md 清单） |
| 语音直接对硬件说话（HW-06）、墨水屏（HW-07） | ⏳ P2，未开始 |
| 多实例/持久化 | ⏳ 当前 session 在内存中，单机演示足够 |
