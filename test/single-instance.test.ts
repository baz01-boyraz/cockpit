import { describe, expect, it, vi } from 'vitest'
import { enforceSingleInstance } from '../electron/main/singleInstance'

type SecondInstanceHandler = () => void

function makeApp(hasLock: boolean) {
  let secondInstanceHandler: SecondInstanceHandler | undefined
  const app = {
    requestSingleInstanceLock: vi.fn(() => hasLock),
    quit: vi.fn(),
    on: vi.fn((event: string, handler: SecondInstanceHandler) => {
      if (event === 'second-instance') secondInstanceHandler = handler
    }),
  }

  return {
    app,
    emitSecondInstance: () => secondInstanceHandler?.(),
  }
}

function makeWindow(minimized: boolean) {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
}

describe('enforceSingleInstance', () => {
  it('quits a second app process before it can create competing services', () => {
    const { app } = makeApp(false)

    expect(enforceSingleInstance(app, () => null)).toBe(false)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.on).not.toHaveBeenCalled()
  })

  it('keeps the primary process and raises its window when the app is opened again', () => {
    const { app, emitSecondInstance } = makeApp(true)
    const window = makeWindow(false)

    expect(enforceSingleInstance(app, () => window)).toBe(true)
    emitSecondInstance()

    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('restores a minimized primary window before focusing it', () => {
    const { app, emitSecondInstance } = makeApp(true)
    const window = makeWindow(true)

    enforceSingleInstance(app, () => window)
    emitSecondInstance()

    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('does nothing when the primary window is not ready yet', () => {
    const { app, emitSecondInstance } = makeApp(true)

    enforceSingleInstance(app, () => null)

    expect(() => emitSecondInstance()).not.toThrow()
    expect(app.quit).not.toHaveBeenCalled()
  })
})
