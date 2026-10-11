# 进度记录 / Progress Log

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v0.2 |
| 更新日期 | 2026-10-11 |
| 当前阶段 | PRD 阶段一「闭环优先」已完成；阶段二硬件交互的接口契约已定义并验证 |

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
  会把小票字节流落盘到 `server/out/receipt-<id>.bin` 并打印 ASCII 预览。

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

### 延迟实测（step-5-preview，同一 prompt）

| 配置 | 耗时 |
| --- | --- |
| `reasoning_effort=medium` + `max_tokens=4000`（当前默认） | 21–32s |
| `reasoning_effort=low` | 28–41s |
| `reasoning_effort=high` | 约 39s |
| `step-3.7-flash`（备用） | 10–16s |

> 关键发现：**思考过程计入 completion_tokens**。`max_tokens=1600` 时正文会被截断甚至返回空内容，
> 因此默认值改为 4000。PRD 的 30 秒目标在 `medium` 下基本达成；现场网络差时用
> `STEPFUN_MODEL=step-3.7-flash` 降级（改一个环境变量）。

---

## 3. 关键决策记录

| 决策 | 理由 |
| --- | --- |
| 服务端做完全部排版与位图转换，硬件只写字节流 | PRD 第 11 节；联调复杂度留在软件侧 |
| 三幕标签由服务端渲染，模型只输出 caption / image_prompt | 减少模型漂移，打印长度可控 |
| 用 `json_schema` + `strict:true` 而不是 JSON Mode | API 级强制约束，比 prompt 里写 Schema 稳定 |
| 思考 + 正文共用一个 `max_tokens` 预算（4000） | 避免推理吃光额度导致正文为空 |
| 断网/超时立即降级，不重试 | 演示不能中断；校验失败才重试 1 次 |
| 无硬件时用 `simulate-action` 代替设备上报 | 与真机共用同一状态机和打印门控，硬件到位后零改动 |
| 插画先用预置线描图 | PRD §13 允许的降级方案；接入出图后只换 `presetImageBitmap()` |
| 前端零依赖零构建 | 可直接静态托管，手机扫码即用 |

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

- [ ] 接入图片生成，替换预置插画（AI-03），保持同一人物设定
- [ ] 现场演示：`PUBLIC_WEB_URL` 改为局域网 IP，小票二维码才能被手机扫开
- [ ] 压测：连续 20 次不断流（PRD 第 9 节）
- [ ] 语音输入在 iOS Safari 的兼容性确认（WEB-02）
