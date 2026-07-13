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

  it('parses canonical Codex event messages without provider-specific duplication', () => {
    const user = JSON.stringify({
      timestamp: '2026-07-12T10:00:00Z',
      type: 'event_msg',
      payload: { type: 'user_message', message: 'Fix the capture pipeline' },
    })
    const assistant = JSON.stringify({
      timestamp: '2026-07-12T10:01:00Z',
      type: 'event_msg',
      payload: { type: 'agent_message', message: 'Implemented and verified.' },
    })

    expect(parseTranscriptLine(user)).toEqual({
      role: 'user',
      text: 'Fix the capture pipeline',
      timestamp: '2026-07-12T10:00:00Z',
    })
    expect(parseTranscriptLine(assistant)).toEqual({
      role: 'assistant',
      text: 'Implemented and verified.',
      timestamp: '2026-07-12T10:01:00Z',
    })
  })

  it('ignores Codex response_item mirrors, tool traffic, and reasoning records', () => {
    for (const line of [
      { type: 'response_item', payload: { role: 'user', content: 'duplicate user turn' } },
      { type: 'response_item', payload: { role: 'assistant', content: 'duplicate reply' } },
      { type: 'event_msg', payload: { type: 'agent_reasoning', text: 'private reasoning' } },
      { type: 'event_msg', payload: { type: 'tool_call', command: 'npm test' } },
    ]) {
      expect(parseTranscriptLine(JSON.stringify(line))).toBeNull()
    }
  })
})
