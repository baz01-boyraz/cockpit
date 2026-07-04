/**
 * Claude Code transcript parsing (pure — docs/memory-imp.md Phase 1.1).
 *
 * A transcript is a `.jsonl` file: one JSON object per line. We only care about
 * the human/assistant turns and their text; tool calls, tool results, summaries
 * and system lines are not conversation and are dropped. This module is the pure
 * line→turn rule; the streaming fs read + redaction live in TranscriptReader.
 */

export interface TranscriptTurn {
  role: 'user' | 'assistant'
  text: string
  timestamp: string | null
}

/** Pull concatenated text out of a transcript `message.content` payload. */
export function extractTurnText(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') {
    return content.trim() || null
  }
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        const t = (block as { text: string }).text.trim()
        if (t) parts.push(t)
      }
    }
    return parts.length > 0 ? parts.join('\n\n') : null
  }
  return null
}

/**
 * Parse one transcript line into a conversation turn, or null when the line is
 * not a human/assistant text turn (tool traffic, summaries, blank lines, or a
 * truncated final line). Never throws — malformed JSON yields null.
 */
export function parseTranscriptLine(line: string): TranscriptTurn | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let obj: Record<string, unknown>
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  const type = obj.type
  if (type !== 'user' && type !== 'assistant') return null
  const text = extractTurnText(obj.message)
  if (!text) return null
  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : null
  return { role: type, text, timestamp }
}
