/**
 * Claude Code and Codex transcript parsing (pure — Memory System v2 capture).
 *
 * A transcript is a `.jsonl` file: one JSON object per line. We only care about
 * canonical human/assistant turns and their text; tool calls, tool results,
 * summaries, reasoning, system lines, and duplicate provider mirrors are
 * dropped. This module is the pure line→turn rule; the streaming fs read +
 * redaction live in TranscriptReader.
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
  const timestamp = typeof obj.timestamp === 'string' ? obj.timestamp : null
  const type = obj.type

  // Claude Code stores canonical turns directly as user/assistant records.
  if (type === 'user' || type === 'assistant') {
    const text = extractTurnText(obj.message)
    return text ? { role: type, text, timestamp } : null
  }

  // Codex writes the same conversation through more than one record family.
  // `event_msg` is the compact canonical stream; deliberately ignore
  // `response_item` below so one exchange is never distilled twice.
  if (type === 'event_msg' && obj.payload && typeof obj.payload === 'object') {
    const payload = obj.payload as Record<string, unknown>
    const role =
      payload.type === 'user_message'
        ? 'user'
        : payload.type === 'agent_message'
          ? 'assistant'
          : null
    const text = typeof payload.message === 'string' ? payload.message.trim() : ''
    return role && text ? { role, text, timestamp } : null
  }

  return null
}
