import { describe, expect, it, vi } from 'vitest'
import type { Terminal } from '@xterm/xterm'
import { NativeInputMask } from './nativeInputMask'

function terminalWithInputBar({
  alternate = false,
  cursorX = 3,
}: {
  alternate?: boolean
  cursorX?: number
} = {}) {
  const paintedCells = Array.from({ length: 80 }, (_, index) => index >= 2 && index < 76)
  const marker = { dispose: vi.fn(), isDisposed: false, line: 0 }
  const classes = new Set<string>()
  const element = {
    classList: {
      add: (...names: string[]) => names.forEach((name) => classes.add(name)),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: vi.fn(),
  } as unknown as HTMLElement
  const decoration = {
    dispose: vi.fn(),
    onRender: vi.fn((paint: (target: HTMLElement) => void) => paint(element)),
  }
  const terminal = {
    cols: 80,
    buffer: {
      active: {
        type: alternate ? 'alternate' : 'normal',
        baseY: 0,
        cursorY: 0,
        cursorX,
        getLine: () => ({
          getCell: (index: number) => ({
            isBgDefault: () => !paintedCells[index],
            isInverse: () => 0,
          }),
        }),
      },
    },
    registerMarker: vi.fn(() => marker),
    registerDecoration: vi.fn(() => decoration),
  }

  return { terminal: terminal as unknown as Terminal, marker, decoration, element }
}

describe('NativeInputMask', () => {
  it('covers a wide native prompt row while the cockpiT composer owns focus', () => {
    const { terminal, element } = terminalWithInputBar()
    const mask = new NativeInputMask(terminal, '#0e0f13')

    mask.setComposerFocused(true)

    expect(terminal.registerDecoration).toHaveBeenCalledWith({
      marker: expect.anything(),
      x: 2,
      width: 74,
      backgroundColor: '#0e0f13',
      foregroundColor: '#0e0f13',
      layer: 'top',
    })
    expect(element.classList.contains('terminal-native-input-mask')).toBe(true)
  })

  it('reveals the native prompt immediately when the composer loses focus', () => {
    const { terminal, marker, decoration } = terminalWithInputBar()
    const mask = new NativeInputMask(terminal, '#0e0f13')
    mask.setComposerFocused(true)

    mask.setComposerFocused(false)

    expect(decoration.dispose).toHaveBeenCalledOnce()
    expect(marker.dispose).toHaveBeenCalledOnce()
  })

  it('never covers an alternate-screen terminal UI', () => {
    const { terminal } = terminalWithInputBar({ alternate: true })
    const mask = new NativeInputMask(terminal, '#0e0f13')

    mask.setComposerFocused(true)

    expect(terminal.registerDecoration).not.toHaveBeenCalled()
  })
})
