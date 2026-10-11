/**
 * 硬件设备通信协议（WebSocket，路径 /device）。
 *
 * 硬件未到位时，用 `npm run mock-device` 起一个模拟设备即可联调全流程。
 *
 * 门控规则（PRD MVP 验收 3：用户未完成硬件动作时，打印不会开始）：
 *   服务端只有在收到 action_complete 后，才会向设备下发 print_authorized；
 *   设备收到 print_authorized 之前不得发送 print_started。
 */

export type Move = 'L' | 'R';

export type DeviceStateName =
  | 'idle'
  | 'generating'
  | 'await_action'
  | 'printing'
  | 'done'
  | 'error'
  | 'offline';

export type DeviceErrorCode = 'paper_out' | 'paper_jam' | 'imu' | 'printer' | 'unauthorized_print' | 'unknown';

export interface PrintScenePayload {
  index: number;
  act: string;
  caption: string;
  imagePrompt: string;
}

/** 服务端 → 设备：完整打印任务（receiptBase64 是整张小票的 ESC/POS 字节流） */
export interface TaskMessage {
  type: 'task';
  sessionId: string;
  title: string;
  scenes: PrintScenePayload[];
  ending: string;
  disclaimer: string;
  shareUrl: string;
  widthPx: number;
  /** 已排版好的 ESC/POS 字节流（含位图与二维码），设备直接写入打印机 */
  receiptBase64: string;
}

export interface ActionRequiredMessage {
  type: 'action_required';
  sessionId: string;
  moves: Move[];
  text: string;
}

export interface PrintAuthorizedMessage {
  type: 'print_authorized';
  sessionId: string;
}

export interface CancelMessage {
  type: 'cancel';
  sessionId: string;
  reason?: string;
}

export type ServerToDevice =
  | TaskMessage
  | ActionRequiredMessage
  | PrintAuthorizedMessage
  | CancelMessage
  | { type: 'welcome'; deviceId: string; serverTime: number }
  | { type: 'pong'; serverTime: number };

export interface HelloMessage {
  type: 'hello';
  deviceId: string;
  firmware?: string;
}

export interface DeviceStateMessage {
  type: 'state';
  deviceId: string;
  state: DeviceStateName;
  sessionId?: string;
  detail?: string;
}

export interface ActionProgressMessage {
  type: 'action_progress';
  sessionId: string;
  done: number;
  total: number;
}

export interface ActionCompleteMessage {
  type: 'action_complete';
  sessionId: string;
  deviceId: string;
}

export interface PrintStartedMessage {
  type: 'print_started';
  sessionId: string;
  deviceId: string;
}

export interface PrintDoneMessage {
  type: 'print_done';
  sessionId: string;
  deviceId: string;
}

export interface DeviceErrorMessage {
  type: 'error';
  deviceId: string;
  code: DeviceErrorCode;
  message?: string;
  sessionId?: string;
}

export interface ButtonMessage {
  type: 'button';
  deviceId: string;
  button: 'retry' | 'cancel';
  sessionId?: string;
}

export type DeviceToServer =
  | HelloMessage
  | DeviceStateMessage
  | ActionProgressMessage
  | ActionCompleteMessage
  | PrintStartedMessage
  | PrintDoneMessage
  | DeviceErrorMessage
  | ButtonMessage
  | { type: 'ping' };
