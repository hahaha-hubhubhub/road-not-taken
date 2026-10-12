import { EventEmitter } from 'node:events';
import type { SessionRecord } from './sessions/store.js';

/** 模块间事件契约：service ↔ device gateway ↔ routes 解耦，避免循环依赖 */
export interface BusEvents {
  /** 故事生成完毕，可以下发任务给硬件 */
  'session:ready': [session: SessionRecord];
  /** 硬件上报动作完成 */
  'device:action_complete': [sessionId: string, deviceId: string];
  /** 硬件上报打印完成 */
  'device:print_done': [sessionId: string, deviceId: string];
  'device:capsule_dispensed': [sessionId: string, deviceId: string];
  /** 硬件上报错误（缺纸/卡纸/IMU 等） */
  'device:error': [payload: { sessionId?: string; deviceId: string; code: string; message?: string }];
  'device:connected': [deviceId: string];
  'device:disconnected': [deviceId: string, connectionKey: string];
}

type Handler<K extends keyof BusEvents> = (...args: BusEvents[K]) => void;

class Bus {
  private ee = new EventEmitter();

  on<K extends keyof BusEvents>(event: K, handler: Handler<K>): this {
    this.ee.on(event, handler as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): this {
    this.ee.emit(event, ...args);
    return this;
  }
}

export const bus = new Bus();
