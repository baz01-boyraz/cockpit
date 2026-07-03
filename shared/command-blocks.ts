/**
 * Command blocks — pure, runtime-dependency-free logic (works in Electron and the
 * browser mock alike).
 *
 * Warp-style terminals wrap each shell command in a "block": the command, its
 * output, an exit-code status, and a timestamp. The boundary between commands is
 * discovered from **OSC 133 semantic prompt marks** (the FinalTerm / iTerm2 /
 * VS Code convention) that a shell integration snippet emits around every prompt:
 *
 *   OSC 133 ; A   — prompt start
 *   OSC 133 ; B   — command start (end of prompt, user input begins)
 *   OSC 133 ; C   — output start (the command is now running)
 *   OSC 133 ; D ; <exit>  — command finished with the given exit code
 *
 * This module only decodes those marks and maps an exit code to a status. It never
 * touches the DOM or a pty, so it can be unit-tested in isolation and reused by the
 * renderer (live decorations) and the main process (Phase 2 block history).
 */

/** OSC identifier for semantic prompt / command marks (FinalTerm, OSC 133). */
export const OSC_COMMAND = 133

export type CommandMarkKind =
  | 'prompt-start' // A
  | 'command-start' // B — end of prompt, input begins
  | 'output-start' // C — command is now running
  | 'command-end' // D[;exit]

export interface CommandMark {
  kind: CommandMarkKind
  /** Present only for `command-end` when the shell reported a numeric exit code. */
  exitCode?: number
}

export type TerminalCommandStatus = 'running' | 'success' | 'error' | 'aborted'

/**
 * A single captured command. The renderer fills `command`/output from the buffer
 * in a later phase; Phase 1 only needs status + timing for gutter decorations.
 */
export interface TerminalCommandBlock {
  id: string
  sessionId: string
  command: string
  cwd?: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  exitCode?: number
  status: TerminalCommandStatus
}

/**
 * Decode an OSC 133 payload — the text between `ESC ] 133 ;` and the terminator —
 * into a typed mark. Unknown or malformed payloads return `null` so callers treat
 * them as "no block change" instead of throwing on an unexpected sequence.
 *
 * Examples: `"A"`, `"B"`, `"C"`, `"D"`, `"D;0"`, `"D;1"`, `"D;130"`.
 */
export function parseOsc133Payload(payload: string): CommandMark | null {
  const parts = payload.split(';')
  switch (parts[0]) {
    case 'A':
      return { kind: 'prompt-start' }
    case 'B':
      return { kind: 'command-start' }
    case 'C':
      return { kind: 'output-start' }
    case 'D': {
      const raw = parts[1]
      if (raw === undefined || raw === '') return { kind: 'command-end' }
      const exit = Number.parseInt(raw, 10)
      return Number.isFinite(exit) ? { kind: 'command-end', exitCode: exit } : { kind: 'command-end' }
    }
    default:
      return null
  }
}

/**
 * Map a shell exit code to a block status. A missing code means the command ended
 * without a numeric result (e.g. interrupted with Ctrl-C, or a shell that reports
 * no exit) — surfaced as `aborted` rather than a false success.
 */
export function commandStatusFromExit(exitCode: number | undefined): TerminalCommandStatus {
  if (exitCode === undefined) return 'aborted'
  return exitCode === 0 ? 'success' : 'error'
}

// --- Stream splitter ---------------------------------------------------------
//
// A pty streams raw bytes in arbitrary chunks: an OSC 133 mark can straddle a
// chunk boundary (`\x1b]133;` in one chunk, `D;0\x07` in the next). To feed the
// block model we need to pull *only* the 133 marks out of the stream and leave
// every other byte — including SGR colour codes we want to keep for the block
// output — untouched. This splitter does exactly that, buffering a partial
// trailing sequence across `feed()` calls so no mark is ever missed or mangled.

const ESC = '\x1b'
const BEL = '\x07'
/** The exact prefix we extract; any other escape (SGR, other OSC) stays as text. */
const OSC133_PREFIX = `${ESC}]133;`
/** Defensive cap: a never-terminated sequence can't grow `pending` without bound. */
const MAX_PENDING = 4096

export type CommandStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'mark'; mark: CommandMark }

/** Is `s` a strict, still-undecidable prefix of an OSC 133 opener? */
function isPartialOscPrefix(s: string): boolean {
  return s.length < OSC133_PREFIX.length && OSC133_PREFIX.startsWith(s)
}

/**
 * Locate the OSC string terminator (BEL, or ST = `ESC \`) at or after `from`.
 * Returns the terminator's start index and the index just past it, or `null`
 * when the terminator has not arrived yet (the caller should buffer and wait).
 */
function findOscTerminator(buf: string, from: number): { at: number; end: number } | null {
  for (let i = from; i < buf.length; i++) {
    if (buf[i] === BEL) return { at: i, end: i + 1 }
    if (buf[i] === ESC) {
      if (i + 1 >= buf.length) return null // maybe a split `ESC \`; wait for more
      if (buf[i + 1] === '\\') return { at: i, end: i + 2 }
    }
  }
  return null
}

/**
 * Splits a raw terminal stream into text runs and OSC 133 marks, resumable across
 * `feed()` calls. Everything that is not a well-formed OSC 133 sequence — plain
 * text, SGR colours, cursor moves, other OSC strings — is passed through verbatim
 * as `text` so the caller can keep colour for block output.
 */
export class CommandStreamSplitter {
  private pending = ''

  feed(chunk: string): CommandStreamEvent[] {
    const events: CommandStreamEvent[] = []
    const buf = this.pending + chunk
    this.pending = ''
    let text = ''
    let i = 0

    const flushText = () => {
      if (text) {
        events.push({ type: 'text', text })
        text = ''
      }
    }

    while (i < buf.length) {
      const esc = buf.indexOf(ESC, i)
      if (esc === -1) {
        text += buf.slice(i)
        break
      }
      text += buf.slice(i, esc)
      const rest = buf.slice(esc)

      if (isPartialOscPrefix(rest)) {
        // Not enough bytes to know if this is a 133 opener — hold and resume next feed.
        this.pending = rest
        break
      }
      if (!rest.startsWith(OSC133_PREFIX)) {
        // Some other escape (SGR/OSC/cursor); keep the ESC as text and scan on.
        text += ESC
        i = esc + 1
        continue
      }

      const payloadStart = esc + OSC133_PREFIX.length
      const term = findOscTerminator(buf, payloadStart)
      if (!term) {
        // Opener seen but terminator hasn't arrived; buffer the whole sequence.
        this.pending = buf.slice(esc)
        break
      }
      flushText()
      const mark = parseOsc133Payload(buf.slice(payloadStart, term.at))
      if (mark) events.push({ type: 'mark', mark })
      i = term.end
    }

    flushText()
    if (this.pending.length > MAX_PENDING) {
      // Malformed / hostile stream: give up on the partial sequence, don't leak it.
      this.pending = ''
    }
    return events
  }
}

// --- Block model -------------------------------------------------------------
//
// Builds the list of captured command blocks from the mark/text event stream.
// Kept pure and time-injected (callers pass `nowMs`) so it is deterministic under
// test; the renderer passes `Date.now()` and mirrors immutable snapshots into
// React state. Mutation is confined to this object's own fields.

/** Upper bound on captured output per block, so a chatty command can't bloat memory. */
const MAX_OUTPUT_CHARS = 256 * 1024
/** Upper bound on retained blocks; a long session keeps only its most recent commands. */
const MAX_BLOCKS = 500

/** A command captured from the stream, with enough to render a foldable card. */
export interface CapturedBlock {
  id: number
  command: string
  output: string
  status: TerminalCommandStatus
  exitCode?: number
  startedAt: number
  endedAt?: number
  durationMs?: number
}

type StreamRegion = 'idle' | 'prompt' | 'command' | 'output'

/** Strip control/escape sequences from an echoed command line and tidy whitespace. */
function cleanCommandText(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const noAnsi = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  // eslint-disable-next-line no-control-regex
  return noAnsi.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').replace(/\r/g, '').trim()
}

export class CommandBlockModel {
  private readonly splitter = new CommandStreamSplitter()
  private region: StreamRegion = 'idle'
  private commandBuf = ''
  private outputBuf = ''
  private current: CapturedBlock | null = null
  private blocks: CapturedBlock[] = []
  private nextId = 1
  private suppressed = false

  /**
   * Pause/resume output capture. While a full-screen TUI (Claude, vim, a pager)
   * repaints the screen, its bytes belong to one long-running block; capturing
   * them would balloon a single block with megabytes of repaint frames, so the
   * renderer suppresses capture for the TUI's lifetime.
   */
  setSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed
  }

  /** Feed one raw pty chunk. Returns true when the block list changed. */
  feed(chunk: string, nowMs: number): boolean {
    let changed = false
    for (const ev of this.splitter.feed(chunk)) {
      if (ev.type === 'text') {
        if (this.region === 'command') this.commandBuf += ev.text
        else if (this.region === 'output' && !this.suppressed) changed = this.appendOutput(ev.text) || changed
        continue
      }
      switch (ev.mark.kind) {
        case 'prompt-start':
          changed = this.abortDangling(nowMs) || changed
          this.region = 'prompt'
          break
        case 'command-start':
          this.region = 'command'
          this.commandBuf = ''
          break
        case 'output-start':
          this.openBlock(nowMs)
          changed = true
          break
        case 'command-end':
          changed = this.closeBlock(ev.mark.exitCode, nowMs) || changed
          break
      }
    }
    return changed
  }

  /**
   * Immutable snapshot for React state — never hands out internal references.
   *
   * INVARIANT: `this.blocks` entries are mutated IN PLACE by appendOutput/
   * openBlock/closeBlock/abortDangling (a deliberate perf tradeoff — no
   * per-chunk allocation). Consumers must therefore ONLY read block data
   * through `snapshot()`; reading `blocks` directly would observe mid-flight
   * mutation and alias state across renders.
   */
  snapshot(): CapturedBlock[] {
    return this.blocks.map((b) => ({ ...b }))
  }

  private appendOutput(text: string): boolean {
    if (!this.current) return false
    if (this.outputBuf.length >= MAX_OUTPUT_CHARS) return false
    this.outputBuf = (this.outputBuf + text).slice(0, MAX_OUTPUT_CHARS)
    this.current.output = this.outputBuf
    return true
  }

  private openBlock(nowMs: number): void {
    this.abortDangling(nowMs)
    const block: CapturedBlock = {
      id: this.nextId++,
      command: cleanCommandText(this.commandBuf),
      output: '',
      status: 'running',
      startedAt: nowMs,
    }
    this.current = block
    this.outputBuf = ''
    const next = [...this.blocks, block]
    this.blocks = next.length > MAX_BLOCKS ? next.slice(next.length - MAX_BLOCKS) : next
    this.region = 'output'
  }

  private closeBlock(exitCode: number | undefined, nowMs: number): boolean {
    if (!this.current) return false
    this.current.status = commandStatusFromExit(exitCode)
    if (exitCode !== undefined) this.current.exitCode = exitCode
    this.current.endedAt = nowMs
    this.current.durationMs = Math.max(0, nowMs - this.current.startedAt)
    this.current.output = this.outputBuf
    this.current = null
    this.outputBuf = ''
    this.region = 'idle'
    return true
  }

  private abortDangling(nowMs: number): boolean {
    if (!this.current) return false
    this.current.status = 'aborted'
    this.current.endedAt = nowMs
    this.current.durationMs = Math.max(0, nowMs - this.current.startedAt)
    this.current.output = this.outputBuf
    this.current = null
    this.outputBuf = ''
    this.region = 'idle'
    return true
  }
}
