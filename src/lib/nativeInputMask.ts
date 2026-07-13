import type { IDecoration, IMarker, Terminal } from '@xterm/xterm'
import { findNativeInputBarSpan } from '@shared/terminal-ux'

interface ActiveMask {
  key: string
  marker: IMarker
  decoration: IDecoration
  cursorInactiveStyle: Terminal['options']['cursorInactiveStyle']
}

/**
 * Visually removes a terminal program's redundant, full-width input bar while
 * cockpiT's editor owns focus. The pty stream is never changed: clicking back
 * into the terminal or entering an alternate-screen app reveals the native UI
 * immediately, so approvals, menus, vim, and other TUIs keep working normally.
 */
export class NativeInputMask {
  private composerFocused = false
  private active: ActiveMask | null = null

  constructor(
    private readonly term: Terminal,
    private readonly background: string,
  ) {}

  setComposerFocused(focused: boolean): void {
    this.composerFocused = focused
    if (focused) this.sync()
    else this.clear()
  }

  sync(): void {
    if (!this.composerFocused || this.term.buffer.active.type === 'alternate') {
      this.clear()
      return
    }

    const buffer = this.term.buffer.active
    const absoluteLine = buffer.baseY + buffer.cursorY
    const line = buffer.getLine(absoluteLine)
    if (!line) {
      this.clear()
      return
    }

    const cells = Array.from({ length: this.term.cols }, (_, column) => {
      const cell = line.getCell(column)
      return {
        painted: Boolean(cell && (!cell.isBgDefault() || cell.isInverse())),
        ghost: Boolean(
          cell &&
          cell.getChars().length > 0 &&
          (cell.isDim() || !cell.isFgDefault()),
        ),
      }
    })
    const span = findNativeInputBarSpan(
      cells.map((cell) => cell.painted),
      buffer.cursorX,
      cells.map((cell) => cell.ghost),
    )
    if (!span) {
      this.clear()
      return
    }

    const key = `${absoluteLine}:${span.start}:${span.end}`
    if (this.active?.key === key) return
    this.clear()

    const marker = this.term.registerMarker(0)
    if (!marker) return
    const decoration = this.term.registerDecoration({
      marker,
      x: span.start,
      width: span.end - span.start,
      backgroundColor: this.background,
      foregroundColor: this.background,
      layer: 'top',
    })
    if (!decoration) {
      marker.dispose()
      return
    }

    decoration.onRender((element) => {
      element.classList.add('terminal-native-input-mask')
      element.setAttribute('aria-hidden', 'true')
    })
    const cursorInactiveStyle = this.term.options.cursorInactiveStyle
    this.term.options.cursorInactiveStyle = 'none'
    this.active = { key, marker, decoration, cursorInactiveStyle }
  }

  dispose(): void {
    this.composerFocused = false
    this.clear()
  }

  private clear(): void {
    const active = this.active
    if (!active) return
    this.active = null
    active.decoration.dispose()
    active.marker.dispose()
    this.term.options.cursorInactiveStyle = active.cursorInactiveStyle
  }
}
