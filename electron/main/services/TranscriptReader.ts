import { createReadStream } from 'node:fs'
import { redactText } from '@shared/redaction'
import { stripAutomaticMemoryContext } from '@shared/memory-context'
import { type TranscriptTurn, parseTranscriptLine } from '@shared/transcript'

export interface TranscriptRead {
  /** Conversation turns discovered past the requested offset. */
  turns: TranscriptTurn[]
  /**
   * Byte offset one past the last COMPLETE line consumed. A trailing line with
   * no newline (a session still being written) is left unconsumed so the next
   * incremental read picks it up whole — this is the capture idempotency key.
   */
  nextOffset: number
}

/**
 * Streams a Claude Code `.jsonl` transcript and extracts redacted conversation
 * turns (docs/memory-imp.md Phase 1.1 + 1.2). Memory-safe: the raw file (tens of
 * MB) is never held whole — only one line at a time plus the small extracted
 * turns. Every turn's text is passed through `redactText` before it leaves this
 * service, so nothing secret-shaped can reach the distiller (security hard rule).
 */
export class TranscriptReader {
  /**
   * Read turns from `fromOffset` (a line boundary, 0 for a fresh read) to EOF.
   * @param redact pass false only for tests that assert raw extraction.
   */
  read(path: string, fromOffset = 0, redact = true): Promise<TranscriptRead> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(path, { start: fromOffset, encoding: 'utf8' })
      const turns: TranscriptTurn[] = []
      let buffer = ''
      let consumed = fromOffset

      const takeLine = (line: string): void => {
        // +1 accounts for the '\n' byte that terminated this line.
        consumed += Buffer.byteLength(line, 'utf8') + 1
        const turn = parseTranscriptLine(line)
        if (!turn) return
        const text = turn.role === 'user' ? stripAutomaticMemoryContext(turn.text) : turn.text
        if (!text) return
        turns.push(redact ? { ...turn, text: redactText(text) } : { ...turn, text })
      }

      stream.on('data', (chunk: string | Buffer) => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        let nl = buffer.indexOf('\n')
        while (nl !== -1) {
          takeLine(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
          nl = buffer.indexOf('\n')
        }
      })
      stream.on('end', () => resolve({ turns, nextOffset: consumed }))
      stream.on('error', (err) => reject(err))
    })
  }
}
