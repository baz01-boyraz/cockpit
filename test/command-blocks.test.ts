import { describe, expect, it } from 'vitest'
import {
  CommandBlockModel,
  CommandStreamSplitter,
  OSC_COMMAND,
  commandStatusFromExit,
  parseOsc133Payload,
} from '@shared/command-blocks'

/** Build an OSC 133 sequence with the BEL terminator, as real shells emit it. */
const osc = (payload: string): string => `\x1b]133;${payload}\x07`

/** Drive a full A/B/command/C/output/D command through a model. */
function runCommand(
  model: CommandBlockModel,
  command: string,
  output: string,
  exit: number | null,
  startMs: number,
): void {
  model.feed(osc('A') + '~/proj ❯ ' + osc('B'), startMs)
  model.feed(`${command}\r\n`, startMs)
  model.feed(osc('C'), startMs)
  if (output) model.feed(output, startMs + 10)
  if (exit !== null) model.feed(osc(`D;${exit}`), startMs + 50)
}

describe('OSC_COMMAND', () => {
  it('is the FinalTerm / OSC 133 identifier', () => {
    expect(OSC_COMMAND).toBe(133)
  })
})

describe('parseOsc133Payload', () => {
  it('decodes prompt lifecycle marks A/B/C', () => {
    expect(parseOsc133Payload('A')).toEqual({ kind: 'prompt-start' })
    expect(parseOsc133Payload('B')).toEqual({ kind: 'command-start' })
    expect(parseOsc133Payload('C')).toEqual({ kind: 'output-start' })
  })

  it('decodes a successful command-end with exit code 0', () => {
    expect(parseOsc133Payload('D;0')).toEqual({ kind: 'command-end', exitCode: 0 })
  })

  it('decodes a failing command-end with a non-zero exit code', () => {
    expect(parseOsc133Payload('D;1')).toEqual({ kind: 'command-end', exitCode: 1 })
    expect(parseOsc133Payload('D;130')).toEqual({ kind: 'command-end', exitCode: 130 })
  })

  it('decodes a bare D with no exit code', () => {
    expect(parseOsc133Payload('D')).toEqual({ kind: 'command-end' })
    expect(parseOsc133Payload('D;')).toEqual({ kind: 'command-end' })
  })

  it('ignores a non-numeric exit code rather than emitting NaN', () => {
    expect(parseOsc133Payload('D;oops')).toEqual({ kind: 'command-end' })
  })

  it('tolerates extra trailing parameters after the mark', () => {
    // Some shells append aid/cwd params, e.g. "A;aid=1". We only read the leader.
    expect(parseOsc133Payload('A;aid=1')).toEqual({ kind: 'prompt-start' })
    expect(parseOsc133Payload('D;0;aid=1')).toEqual({ kind: 'command-end', exitCode: 0 })
  })

  it('returns null for unknown or empty payloads', () => {
    expect(parseOsc133Payload('')).toBeNull()
    expect(parseOsc133Payload('Z')).toBeNull()
    expect(parseOsc133Payload('P;Cwd=/x')).toBeNull()
  })
})

describe('commandStatusFromExit', () => {
  it('maps exit 0 to success', () => {
    expect(commandStatusFromExit(0)).toBe('success')
  })

  it('maps any non-zero exit to error', () => {
    expect(commandStatusFromExit(1)).toBe('error')
    expect(commandStatusFromExit(127)).toBe('error')
    expect(commandStatusFromExit(130)).toBe('error')
  })

  it('maps a missing exit code to aborted', () => {
    expect(commandStatusFromExit(undefined)).toBe('aborted')
  })
})

describe('CommandStreamSplitter', () => {
  it('splits text runs from OSC 133 marks', () => {
    const events = new CommandStreamSplitter().feed(`before${osc('C')}after${osc('D;0')}`)
    expect(events).toEqual([
      { type: 'text', text: 'before' },
      { type: 'mark', mark: { kind: 'output-start' } },
      { type: 'text', text: 'after' },
      { type: 'mark', mark: { kind: 'command-end', exitCode: 0 } },
    ])
  })

  it('passes SGR colour codes through as text (only 133 marks are extracted)', () => {
    const events = new CommandStreamSplitter().feed('\x1b[38;5;150m✓ ok\x1b[0m')
    expect(events).toEqual([{ type: 'text', text: '\x1b[38;5;150m✓ ok\x1b[0m' }])
  })

  it('passes an unrelated OSC (window title) through as text', () => {
    const events = new CommandStreamSplitter().feed('\x1b]0;my title\x07done')
    expect(events).toEqual([{ type: 'text', text: '\x1b]0;my title\x07done' }])
  })

  it('reassembles a mark whose opener is split across feeds', () => {
    const s = new CommandStreamSplitter()
    expect(s.feed('out\x1b]13')).toEqual([{ type: 'text', text: 'out' }])
    expect(s.feed('3;D;1\x07')).toEqual([{ type: 'mark', mark: { kind: 'command-end', exitCode: 1 } }])
  })

  it('reassembles a mark whose terminator arrives in a later feed', () => {
    const s = new CommandStreamSplitter()
    expect(s.feed('\x1b]133;D;0')).toEqual([])
    expect(s.feed('\x07next')).toEqual([
      { type: 'mark', mark: { kind: 'command-end', exitCode: 0 } },
      { type: 'text', text: 'next' },
    ])
  })

  it('accepts the ST (ESC backslash) terminator', () => {
    const events = new CommandStreamSplitter().feed('\x1b]133;A\x1b\\hi')
    expect(events).toEqual([
      { type: 'mark', mark: { kind: 'prompt-start' } },
      { type: 'text', text: 'hi' },
    ])
  })
})

describe('CommandBlockModel', () => {
  it('captures a successful command with its output and timing', () => {
    const model = new CommandBlockModel()
    runCommand(model, 'npm run build', 'built in 1.2s\r\n', 0, 1000)
    const blocks = model.snapshot()
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      command: 'npm run build',
      status: 'success',
      exitCode: 0,
      startedAt: 1000,
      endedAt: 1050,
      durationMs: 50,
    })
    expect(blocks[0].output).toContain('built in 1.2s')
  })

  it('marks a non-zero exit as an error block', () => {
    const model = new CommandBlockModel()
    runCommand(model, 'npm test', 'expected 3, got 2\r\n', 1, 0)
    expect(model.snapshot()[0]).toMatchObject({ status: 'error', exitCode: 1 })
  })

  it('marks a command interrupted before D (Ctrl-C) as aborted at the next prompt', () => {
    const model = new CommandBlockModel()
    model.feed(osc('A') + '❯ ' + osc('B'), 0)
    model.feed('sleep 100\r\n', 0)
    model.feed(osc('C'), 0)
    model.feed(osc('A'), 500) // new prompt with no D — the command was interrupted
    const [block] = model.snapshot()
    expect(block).toMatchObject({ command: 'sleep 100', status: 'aborted' })
    expect(block.exitCode).toBeUndefined()
  })

  it('captures no blocks when the stream carries no marks (no shell integration)', () => {
    const model = new CommandBlockModel()
    model.feed('plain scrollback with no OSC 133 marks\r\n', 0)
    expect(model.snapshot()).toEqual([])
  })

  it('preserves a multi-line command', () => {
    const model = new CommandBlockModel()
    model.feed(osc('A') + '❯ ' + osc('B'), 0)
    model.feed('echo one\necho two\r\n', 0)
    model.feed(osc('C') + 'one\ntwo\r\n' + osc('D;0'), 10)
    expect(model.snapshot()[0].command).toBe('echo one\necho two')
  })

  it('captures rapid back-to-back commands as separate blocks', () => {
    const model = new CommandBlockModel()
    runCommand(model, 'pwd', '/home\r\n', 0, 0)
    runCommand(model, 'whoami', 'baz\r\n', 0, 100)
    runCommand(model, 'false', '', 1, 200)
    const blocks = model.snapshot()
    expect(blocks.map((b) => b.command)).toEqual(['pwd', 'whoami', 'false'])
    expect(blocks.map((b) => b.status)).toEqual(['success', 'success', 'error'])
  })

  it('reassembles blocks when marks are split across chunk boundaries', () => {
    const model = new CommandBlockModel()
    model.feed(`${osc('A')}❯ ${osc('B')}ls\r\n`, 0)
    model.feed('\x1b]13', 0) // split opener of the C mark
    model.feed('3;C\x07file-a\n', 0)
    model.feed('file-b\n\x1b]133;D;0\x07', 20)
    const [block] = model.snapshot()
    expect(block).toMatchObject({ command: 'ls', status: 'success' })
    expect(block.output).toContain('file-a')
    expect(block.output).toContain('file-b')
  })

  it('suppresses output capture during a full-screen TUI but still closes the block', () => {
    const model = new CommandBlockModel()
    model.feed(osc('A') + '❯ ' + osc('B'), 0)
    model.feed('vim notes.txt\r\n', 0)
    model.feed(osc('C'), 0)
    model.setSuppressed(true)
    model.feed('\x1b[2J\x1b[H...thousands of repaint bytes...', 10)
    model.setSuppressed(false)
    model.feed(osc('D;0'), 900)
    const [block] = model.snapshot()
    expect(block).toMatchObject({ command: 'vim notes.txt', status: 'success' })
    expect(block.output).toBe('') // repaint frames were never captured
  })

  it('hands out immutable snapshots (mutating one never touches model state)', () => {
    const model = new CommandBlockModel()
    runCommand(model, 'pwd', '/home\r\n', 0, 0)
    const first = model.snapshot()
    first[0].command = 'tampered'
    expect(model.snapshot()[0].command).toBe('pwd')
  })

  it('caps retained blocks so a long session cannot grow without bound', () => {
    const model = new CommandBlockModel()
    for (let i = 0; i < 620; i++) runCommand(model, `cmd-${i}`, 'ok\r\n', 0, i * 100)
    const blocks = model.snapshot()
    expect(blocks).toHaveLength(500)
    // The most recent command is retained; the oldest were dropped from the front.
    expect(blocks[blocks.length - 1].command).toBe('cmd-619')
    expect(blocks[0].command).toBe('cmd-120')
  })

  it('bounds a single block’s captured output', () => {
    const model = new CommandBlockModel()
    model.feed(osc('A') + '❯ ' + osc('B'), 0)
    model.feed('yes\r\n', 0)
    model.feed(osc('C'), 0)
    model.feed('x'.repeat(400 * 1024), 10) // 400 KB of output
    model.feed(osc('D;0'), 20)
    expect(model.snapshot()[0].output.length).toBeLessThanOrEqual(256 * 1024)
  })
})
