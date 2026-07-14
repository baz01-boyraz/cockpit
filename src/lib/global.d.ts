import type { CockpitApi } from '@shared/ipc'
import type { MemoryCaptureNotice } from '@shared/memory-capture'

declare global {
  interface Window {
    cockpit?: CockpitApi
    /** Plain-browser preview only; absent from the Electron preload surface. */
    __cockpitMock?: {
      emitMemoryCaptureNotice(notice: MemoryCaptureNotice): void
    }
  }
}

export {}
