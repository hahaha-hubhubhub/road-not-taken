# 进度记录 / Progress Log

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.3（历史实测数据 + 2026-10-12 胶囊增量） |
| 更新日期 | 2026-10-12 |
| 当前阶段 | 小票软件闭环已验证；胶囊协议/模拟器已验证，真实封装机构未验证 |

---

## 1. 本次完成内容

**服务端（server/，Node 26 + TypeScript + Express + ws）**

- LLM 层：接 StepFun `step-5-preview`，用 `json_schema` + `strict:true` 做 API 级结构化输出，
  zod 二次校验，失败重试 1 次后降级到预生成案例。
- Prompt 封装：三幕结构（滤镜/代价/意外）、写法要求、内容边界、PRD 示例 few-shot。
- 安全：输入过滤（过短/禁止内容/心理危机）、输出兜底、服务端统一免责声明。
- 会话状态机：`created → generating → await_action → printing → done / error`，
  内存存储 + 24 小时 TTL 自动清除（OPS-03）。
- REST API：session 创建/生成/查询/结果/二维码/演示案例/设备状态/取消。
- 设备网关：WebSocket `/device`，任务下发、动作指令、**打印门控**、错误上报。
- 打印管线：PNG → 1-bit Floyd–Steinberg 抖动 → ESC/POS 光栅位图；GBK 文本；二维码位图；
  整张小票排版成一条字节流下发给设备。
- 模拟设备（`npm run mock-device`）：硬件未到位时完整复现真机行为，
  （2026-10-11 历史行为）会把小票字节流落盘；当前版本改为仅 `--save-receipt` 调试时落盘到 `server/out/`。

**前端（web/，纯静态零依赖）**

- 输入（10–100 字 + 语音）→ 生成中 → 等待动作 → 打印中 → 结果小票。
- 有设备显示翻转指令与进度；无设备提供"演示"按钮，走同一状态机与门控。
- 保存长图（canvas）、分享链接（`#/r/<id>`）、二维码、演示模式（内置 4 个案例）。

**文档**：`docs/ARCHITECTURE.md`（架构 + 全部接口契约 + 打印管线 + 实测数据）。

---

## 2. 验证结果（2026-10-11，本机实测）

`cd server && npm run smoke` —— **全部通过**：

| 路径 | 结果 |
| --- | --- |
| A 无硬件（演示模式） | 创建 → 生成（kind=story，23.6s）→ 三幕 + 标题 + 结尾 + 免责声明齐全 → 模拟打印 → done |
| B 真实 WS 设备通道（模拟设备） | 创建 → 生成（kind=story，29.3s）→ 设备上线 → 任务下发 → 3 步翻转 → 打印授权 → 打印完成 → done |

其他验证：

- 输入过短 → 400 且不调用模型；含"不想活了"等危机输入 → 返回安抚文案（`kind=care`），不写黑色幽默。
- 小票字节流 73,661 字节，文本折行/虚线/三张插画/二维码共 8 段位图，ASCII 预览正确。
- `GET /api/sessions/:id/qr.png` 返回 480×480 PNG；`/img/act-*.png` 等静态资源 200。
- `tsc --noEmit` 无错误；`node --check web/app.js` 通过。
- 静态托管已部署：`https://calm-willow-8970.page.stepcloud.com`（steppage，web/ 目录原样托管，
  无后端时自动进入演示模式，可用 `?api=http://<局域网IP>:8787` 指向本地服务）。

### 2.1 真实浏览器端到端（CDP，不是 dump-dom）

`--dump-dom` / `--screenshot` 会在页面 load 事件后就地 dump，**等不到异步生成**，
容易把"降级路径"误判成"主路径通过"。因此新增基于 Chrome DevTools Protocol 的检查脚本：

```bash
cd server
npm run browser-check -- "http://127.0.0.1:8787/?autostart=如果我当时没有学计算机" 150000
```

它会真的开一个 Chrome，等模型生成完，自动点掉「我完成了翻转（演示）」，然后断言：
无离线横幅、结果视图可见、三幕标签 = 3、二维码存在、无"演示案例"降级标记。

实测通过（多次）："如果我当时没有学计算机" → 46.8s 出票，标题「另一条路：不写代码」；
"如果我当时回家了家乡工作" → 「另一条路有热饭，也有七大姑」。

### 2.2 修掉的一个关键 bug（记录在案）

**现象**：本地页面显示"未连接本地服务，当前是演示模式"，但服务端 `/api/health` 完全正常。

**根因**：前端 `api()` 用 `fetch(state.apiBase + path)` 拼 URL，而 `apiBase` 是 origin
（`http://127.0.0.1:8787`），`path` 却写成 `/health`、`/sessions` —— 少了 `/api` 前缀。
浏览器实际请求 `GET /health` → 404 text/html → 被"必须返回 JSON"的检查判为离线 → 走降级。
服务端冒烟测试一直通过（curl 走的是正确路径），所以这个 bug 只在浏览器里暴露。

**修复**：`api()` 统一用 `apiUrl()` 拼 `/api` 前缀；同时给 API 响应加 `Cache-Control: no-store`
（避免轮询接口被缓存 / 304 干扰）。

**教训**：服务端测试全绿 ≠ 前端能连通。浏览器侧验证必须用能等待异步完成的工具
（本项目的 `npm run browser-check`），并页面上要留下可观测状态
（`document.body.dataset.offlineReason` / `lastApi`，这次就是靠它定位到 404）。

### 2.3 延迟实测（step-5-preview，同一 prompt）

| 配置 | 耗时 |
| --- | --- |
| `reasoning_effort=medium` + `max_tokens=8000`（当前默认） | 21–34s |
| `reasoning_effort=low` | 28–41s |
| `reasoning_effort=high` | 约 39s |
| `step-3.7-flash`（备用） | 10–16s |

> 关键发现 1：**思考过程计入 completion_tokens**。`max_tokens=1600` 时正文会被截断甚至返回空内容，
> 4000 时偶发仍被截断（实测一次思考 3500+ tokens，重试后总耗时 77 秒），
> 因此默认值改为 **8000**，并在被截断时自动加额 1.5 倍重试（上限 12000）。
>
> 关键发现 2：单次耗时方差较大（21–53 秒），取决于模型思考长度。PRD 的 30 秒目标在 `medium` 下
> 基本达成；现场网络差或要求稳定 15 秒内时，用 `STEPFUN_MODEL=step-3.7-flash` 降级（改一个环境变量）。

---

## 3. 关键决策记录

| 决策 | 理由 |
| --- | --- |
| 服务端做完全部排版与位图转换，硬件只写字节流 | PRD 第 11 节；联调复杂度留在软件侧 |
| 三幕标签由服务端渲染，模型只输出 caption / image_prompt | 减少模型漂移，打印长度可控 |
| 用 `json_schema` + `strict:true` 而不是 JSON Mode | API 级强制约束，比 prompt 里写 Schema 稳定 |
| 思考 + 正文共用一个 `max_tokens` 预算（默认 8000） | 避免推理吃光额度导致正文为空/截断 |
| 断网/超时立即降级，不重试 | 演示不能中断；校验失败才重试 1 次 |
| 无硬件时用 `simulate-action` 代替设备上报 | 与真机共用同一状态机和打印门控，硬件到位后零改动 |
| 插画先用预置线描图 | PRD §13 允许的降级方案；接入出图后只换 `presetImageBitmap()` |
| 前端零依赖零构建 | 可直接静态托管，手机扫码即用 |
| 静态托管用 steppage | 与 StepFun 同平台，一把 Key；无后端时页面自动进入演示模式 |
| 浏览器验证用 CDP 脚本而不是 `--dump-dom` | dump-dom 等不到异步生成，会把降级路径误判成通过 |

---

## 4. 待办

### 硬件（采购后，对应 PRD 阶段二/三）

- [ ] 采购：树莓派 Zero 2 W（或 Pico W）、MPU6050、WS2812 灯带、蜂鸣器、58mm 热敏打印机、锂电池、外壳
- [ ] 固件按 `server/src/device/protocol.ts` 实现消息收发
- [ ] IMU 翻面计数（z 轴符号变化 + 阈值去抖），接入 `action_progress` / `action_complete`
- [ ] LED / 音效映射 5 种状态（HW-02）
- [ ] 缺纸/卡纸检测与 `error` 上报（HW-02/HW-05）
- [ ] 注意：小票字节流约 73KB，打印机请用 USB 或 ≥115200 波特率

### 软件

- [x] 接入图片生成的前置工作：画面提示词已由模型生成（AI-02），插画先用预置线描（AI-03 降级）
- [ ] 接入图片生成模型，替换预置插画（AI-03），保持同一人物设定
- [x] 前端静态托管（steppage）：https://calm-willow-8970.page.stepcloud.com
- [x] 前端「设置」面板：填 API Key / 切模型 / 改服务端地址（见第 5 节）
- [ ] 现场演示：`PUBLIC_WEB_URL` 改为局域网 IP，小票二维码才能被手机扫开
- [ ] 压测：连续 20 次不断流（PRD 第 9 节）
- [ ] 语音输入在 iOS Safari 的兼容性确认（WEB-02）
- [ ] 现场网络对 `stepcloud.com` 的访问确认（本机 TLS 被阻断，未能从开发机验证线上页面）

---

## 5. API Key 改为前端「设置」填写（2026-10-11）

需求：克隆仓库后 `npm start` 就能跑，Key 不写进 `.env`，在页面上填。

实现：

- 前端「设置」面板（右上角 ⚙ / 状态 pill 点击进入，或 `?settings=1` 深链）：
  API Key（密码框 + 显示切换）、模型选择、服务端地址；存 `localStorage`。
- 请求头传递：`X-Stepfun-Api-Key`、`X-Stepfun-Model`（CORS 已放行这两个头）。
- 服务端优先级：**请求头 Key > `.env` Key**；两者都没有时返回明确错误并让前端弹设置面板，
  **不再静默降级**——只有显式 `MOCK_LLM=1` 才走预生成案例。
- `/health` 增加 `hasServerKey` / `mockLlm`；右上角状态 pill 显示
  「已就绪 · 模型」/「未设置 Key」/「未连接服务」/「演示模式」。
- 首次进入且无任何 Key 时自动弹出设置面板（只提示一次）。

验证：

| 场景 | 结果 |
| --- | --- |
| 无 Key，浏览器打开 | 状态「未设置 Key」+ 设置面板自动弹出 + 生成报明确错误 ✅ |
| 页面设置里填 Key（localStorage 注入模拟） | 28.6s 出票，三幕 + 二维码，状态「已就绪 · step-5-preview」✅ |
| Key 走请求头（smoke） | 两条路径全过，kind=story（26.3s / 58.7s）✅ |
| 无 Key（smoke） | 正确走到「未配置 Key」提示分支 ✅ |
| CORS 预检（Origin 为静态托管域名） | `Access-Control-Allow-Headers` 含 `X-Stepfun-Api-Key` / `X-Stepfun-Model` ✅ |

> 安全提醒：Key 存在浏览器里 = 谁能打开这个页面谁就能用你的 Key，
> 所以只建议 localhost / 局域网自用；部署到公网时改用服务端 `.env` 并加访问令牌。

## 6. 2026-10-12 产品拷打与胶囊软件增量

- 按 SpaceZephyr/pm-skills `4c486c7` 的总控→需求体检→多角色评审→优先级→低样本验证链路产出 [产品拷打记录](PRODUCT_REVIEW.md) 与 [胶囊 PRD](CAPSULE_PRD.md)。**实体公开演示评审不通过**：卷纸/出仓安全、设备鉴权与隐私未验收。
- 软件：胶囊能力握手、文字内芯 ESC/POS、打印后单独封装状态/授权/出仓门控，危机输入不下发设备，取消时异步生成不复活；模拟设备默认不落盘、HTTP 日志不记录查询参数；模拟设备可跑完整状态。旧设备按小票模式继续。
- 验证：`npm run build`、`node --check web/app.js`、`MOCK_LLM=1` 下 `npm run capsule-check`（提前/无效出仓消息、危机路径、同名连接越权、卡纸与迟到 ACK）以及 `npm run smoke` 两条路径、真实 Chrome 的 `RNT_ALLOW_DEMO=1 npm run browser-check`（模拟封装阶段）已通过。**这不是硬件测试，也不是模型内容安全评测**。
- 待办：台架 40 次（空白/文字各 20）与故障注入、真机互锁、纸长/卷径/切刀验证；内容可用性访谈与受控体验；鉴权/访问控制/用户同意/匿名指标；正式展台前复评。文档 §2 旧延迟为 2026-10-11 的历史数据，勿冒充本次测试。

---

---

## 7. 接入黑客松中转 + 生图（2026-10-12，代码已接，待 VPN 验证）

拿到的东西：Key（heikesong-23 组，5 人共享 ¥2000/人；完整值只写在 .env，勿外传）、
Base URL `https://models-proxy.stepfun-inc.com`（**内网域名，必须连 VPN**，
开发机 DNS 解析不到，所以本轮只写代码、不实测）。

已完成：

| 项 | 状态 |
| --- | --- |
| Base URL 可配置（页面设置 + `X-Stepfun-Base-Url` 请求头） | ✅ |
| `.env` 写入 Key / Base URL / 生图模型（gitignore，未提交） | ✅ |
| 生图模块 `llm/images.ts`：三幕并发、单张超时、失败回退预置插画 | ✅ |
| 生图接入 session 流程：故事就绪即并发生图，打印前最多等 15s | ✅ |
| `GET /api/sessions/:id/scene/:n.png`（生成图优先 + `X-Image-Source` 头） | ✅ |
| 小票使用生成图（复用现有抖动 / 1-bit / ESC/POS 管线） | ✅ |
| 前端：生图模型输入框、「生成中」占位、出票后继续轮询补图 | ✅ |

已验证（连不上中转的情况下，验证的是降级链路）：

- 文本调用失败 → 1 秒内降级到预生成案例（`kind=demo`），冒烟测试全过
- 三张生图全部 `Connection error` → 回退预置插画，`X-Image-Source: preset`，出票不卡
- `scene/9.png` → 404；`tsc --noEmit` / `node --check` 通过

**待接上 VPN 后做**：

1. `GET {base}/models` 核对 step-5-preview 与生图模型的真实 ID
2. 验证中转是否支持 `response_format: json_schema` 严格模式；不支持就降级 JSON Mode（链路已备）
3. 跑一次真实出图，看画风是否适合 58mm 热敏打印（必要时调 `STYLE_SUFFIX`）
4. 确认 base URL 要不要补 `/v1`
