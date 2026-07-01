import type { IDecoration, IMarker, Terminal } from '@xterm/xterm'
import {
  type TerminalCommandStatus,
  commandStatusFromExit,
  parseOsc133Payload,
} from '@shared/command-blocks'

/**
 * Warp-style command decorations on an xterm terminal, driven by OSC 133 marks.
 *
 * xterm is a grid renderer and cannot fold line ranges inline, so Phase 1 draws
 * lightweight, non-intrusive decorations instead: a status dot in the left gutter
 * of each command's first output line (amber while running → lime on success, red
 * on failure), a matching tick in the overview ruler, and a hairline separator at
 * the top of every prompt. True foldable blocks come in Phase 2.
 *
 * All positioning uses xterm's stable marker/decoration API; every element is
 * tagged with CSS classes so the look lives in `components.css`.
 */

// Overview-ruler tick colours (mirror the ember/lime/red design tokens).
const RULER_RUNNING = '#ee7c42'
const RULER_SUCCESS = '#82d08f'
const RULER_ERROR = '#ed6450'

interface OpenBlock {
  marker: IMarker
  dot: IDecoration
  dotEl: HTMLElement | null
}

function rulerColor(status: TerminalCommandStatus): string {
  if (status === 'success') return RULER_SUCCESS
  if (status === 'error') return RULER_ERROR
  return RULER_RUNNING
}

export class CommandBlockDecorations {
  private open: OpenBlock | null = null
  private readonly tracked = new Set<IDecoration>()
  /** One marker per captured command, for jump-to-previous/next navigation. */
  private commandMarkers: IMarker[] = []
  private disposed = false

  constructor(private readonly term: Terminal) {}

  /** React to one OSC 133 payload (the text after `ESC ] 133 ;`). */
  handlePayload(payload: string): void {
    if (this.disposed) return
    const mark = parseOsc133Payload(payload)
    if (!mark) return
    switch (mark.kind) {
      case 'output-start':
        this.openBlock()
        break
      case 'command-end':
        this.closeBlock(commandStatusFromExit(mark.exitCode))
        break
      case 'prompt-start':
        this.addSeparator()
        break
      default:
        // 'command-start' (B) needs no decoration in Phase 1.
        break
    }
  }

  private openBlock(): void {
    // Defensively close a still-open block (e.g. a missed D mark before the next C).
    if (this.open) this.closeBlock('aborted')
    const marker = this.term.registerMarker(0)
    if (!marker) return
    const dot = this.term.registerDecoration({ marker, x: 0, width: 1 })
    if (!dot) {
      marker.dispose()
      return
    }
    const block: OpenBlock = { marker, dot, dotEl: null }
    dot.onRender((el) => {
      block.dotEl = el
      el.classList.add('cmdblock-dot', 'cmdblock-dot--running')
      el.dataset.status = 'running'
    })
    this.tracked.add(dot)
    this.commandMarkers.push(marker)
    this.open = block
  }

  /** Live markers only — drop any that scrolled out of scrollback or were disposed. */
  private liveMarkers(): IMarker[] {
    this.commandMarkers = this.commandMarkers.filter((m) => !m.isDisposed && m.line >= 0)
    return this.commandMarkers
  }

  /** Scroll the viewport to the newest command whose line sits above the fold. */
  scrollToPrevCommand(): void {
    if (this.disposed) return
    const top = this.term.buffer.active.viewportY
    const target = [...this.liveMarkers()].reverse().find((m) => m.line < top)
    if (target) this.term.scrollToLine(target.line)
  }

  /** Scroll to the next command below the fold, or to the bottom when past the last. */
  scrollToNextCommand(): void {
    if (this.disposed) return
    const top = this.term.buffer.active.viewportY
    const target = this.liveMarkers().find((m) => m.line > top)
    if (target) this.term.scrollToLine(target.line)
    else this.term.scrollToBottom()
  }

  /** Jump to the live tail of the terminal (most recent output). */
  scrollToLatest(): void {
    if (this.disposed) return
    this.term.scrollToBottom()
  }

  private closeBlock(status: TerminalCommandStatus): void {
    const block = this.open
    if (!block) return
    this.open = null
    const paint = (el: HTMLElement) => {
      el.classList.remove('cmdblock-dot--running')
      el.classList.add(`cmdblock-dot--${status}`)
      el.dataset.status = status
    }
    if (block.dotEl) paint(block.dotEl)
    else block.dot.onRender(paint)
    // Colour the overview-ruler tick now that the outcome is known.
    const ruler = this.term.registerDecoration({
      marker: block.marker,
      overviewRulerOptions: { color: rulerColor(status), position: 'right' },
    })
    if (ruler) this.tracked.add(ruler)
  }

  private addSeparator(): void {
    const marker = this.term.registerMarker(0)
    if (!marker) return
    const sep = this.term.registerDecoration({ marker, x: 0, width: 1 })
    if (!sep) {
      marker.dispose()
      return
    }
    sep.onRender((el) => el.classList.add('cmdblock-sep'))
    this.tracked.add(sep)
  }

  dispose(): void {
    this.disposed = true
    this.open = null
    for (const decoration of this.tracked) decoration.dispose()
    this.tracked.clear()
  }
}
