import { describe, expect, it } from 'vitest'
import { extractTurnText, parseTranscriptLine } from '@shared/transcript'

describe('extractTurnText', () => {
  it('reads a string content payload', () => {
    expect(extractTurnText({ content: 'hello there' })).toBe('hello there')
  })

  it('concatenates text blocks and skips tool blocks', () => {
    const message = {
      content: [
        { type: 'text', text: 'first' },
        { type: 'tool_use', name: 'Bash', input: {} },
        { type: 'text', text: 'second' },
      ],
    }
    expect(extractTurnText(message)).toBe('first\n\nsecond')
  })

  it('returns null for tool-only or empty content', () => {
    expect(extractTurnText({ content: [{ type: 'tool_result', content: 'x' }] })).toBeNull()
    expect(extractTurnText({ content: '   ' })).toBeNull()
    expect(extractTurnText({})).toBeNull()
    expect(extractTurnText(null)).toBeNull()
  })
})

describe('parseTranscriptLine', () => {
  it('parses a user turn', () => {
    const line = JSON.stringify({ type: 'user', timestamp: '2026-07-04T10:00:00Z', message: { content: 'hi' } })
    expect(parseTranscriptLine(line)).toEqual({ role: 'user', text: 'hi', timestamp: '2026-07-04T10:00:00Z' })
  })

  it('parses an assistant turn with block content', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'answer' }] },
    })
    expect(parseTranscriptLine(line)).toEqual({ role: 'assistant', text: 'answer', timestamp: null })
  })

  it('drops non-conversation lines and never throws on junk', () => {
    expect(parseTranscriptLine(JSON.stringify({ type: 'summary', summary: 'x' }))).toBeNull()
    expect(parseTranscriptLine(JSON.stringify({ type: 'system', content: 'boot' }))).toBeNull()
    expect(parseTranscriptLine('{ not valid json')).toBeNull()
    expect(parseTranscriptLine('')).toBeNull()
  })
})
