import { EventEmitter } from 'node:events'
import type { AppUpdateState, TerminalExitEvent, TerminalOutputChunk } from '@shared/domain'

/**
 * Internal main-process event bus. Services emit here; the IPC layer subscribes
 * and forwards a curated subset to the renderer via webContents.send. This keeps
 * services decoupled from Electron's window/webContents lifecycle.
 */
export interface CockpitEventMap {
  'terminal:data': TerminalOutputChunk
  'terminal:exit': TerminalExitEvent
  'approvals:changed': { projectId: string }
  'logs:changed': { projectId: string }
  'appUpdate:changed': AppUpdateState
}

export class CockpitEvents extends EventEmitter {
  emitTyped<K extends keyof CockpitEventMap>(event: K, payload: CockpitEventMap[K]): void {
    this.emit(event, payload)
  }

  onTyped<K extends keyof CockpitEventMap>(
    event: K,
    listener: (payload: CockpitEventMap[K]) => void,
  ): void {
    this.on(event, listener as (payload: unknown) => void)
  }
}
