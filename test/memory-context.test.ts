import { describe, expect, it } from 'vitest'
import type { MemoryDoc } from '../shared/memory-hub'
import {
  buildMemoryContext,
  stripAutomaticMemoryContext,
  wrapTaskWithMemory,
} from '../shared/memory-context'

const docs: MemoryDoc[] = [
  {
    name: 'unrelated-newer',
    updatedAt: '2026-07-10T12:00:00.000Z',
    content: '# Billing window\n\nInvoices are reconciled at midnight.',
  },
  {
    name: 'landing-page-visual-direction',
    updatedAt: '2026-07-01T12:00:00.000Z',
    content: [
      '# Landing page visual direction',
      '',
      'Landing pages use molten obsidian surfaces, copper accents, and restrained signal lime.',
      'Avoid generic blue gradients and preserve the existing display typeface.',
    ].join('\n'),
  },
]

describe('buildMemoryContext', () => {
  it('ranks by task relevance and injects real note content with provenance', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_test',
      surface: 'terminal_codex',
      query: 'Redesign the landing page hero and visual system',
      docs,
    })

    expect(result.receipt.status).toBe('ready')
    expect(result.receipt.notes[0].name).toBe('landing-page-visual-direction')
    expect(result.block).toContain('.cockpit-memory/landing-page-visual-direction.md')
    expect(result.block).toContain('molten obsidian surfaces, copper accents')
    expect(result.block).toContain('context_id: memctx_test')
  })

  it('redacts secret-shaped content before it reaches an engine prompt', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_secret',
      surface: 'hermes_chat',
      query: 'deployment gotcha',
      docs: [
        {
          name: 'deployment-gotcha',
          updatedAt: '2026-07-10T12:00:00.000Z',
          content: 'The failed token was sk_live_51H2eKLAbCdEfGh123456 and must never leave memory.',
        },
      ],
    })

    expect(result.block).toContain('[REDACTED]')
    expect(result.block).not.toContain('sk_live_')
  })

  it('honours the total context budget and marks truncated notes', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_budget',
      surface: 'claude_chat',
      query: 'large architecture note',
      docs: [
        {
          name: 'large-architecture-note',
          updatedAt: '2026-07-10T12:00:00.000Z',
          content: `Architecture invariant. ${'x'.repeat(10_000)}`,
        },
      ],
      limits: { maxNotes: 1, maxChars: 1_200, maxNoteChars: 700 },
    })

    expect(result.block.length).toBeLessThanOrEqual(1_200)
    expect(result.receipt.notes[0].truncated).toBe(true)
    expect(result.block).toContain('[truncated')
  })

  it('returns an explicit empty receipt instead of pretending memory was loaded', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_empty',
      surface: 'council_spec',
      query: 'anything',
      docs: [],
    })

    expect(result.receipt.status).toBe('empty')
    expect(result.receipt.notes).toEqual([])
    expect(result.block).toContain('status: empty')
  })
})

describe('wrapTaskWithMemory', () => {
  it('places the automatic memory check before the user task', () => {
    const context = buildMemoryContext({
      contextId: 'memctx_order',
      surface: 'terminal_claude',
      query: 'Redesign landing page',
      docs,
    })
    const prompt = wrapTaskWithMemory('Redesign landing page', context)

    expect(prompt.indexOf('COCKPIT PROJECT MEMORY')).toBeLessThan(
      prompt.indexOf('Redesign landing page'),
    )
    expect(prompt).toContain('USER TASK')
  })

  it('can remove the injected block before transcript distillation', () => {
    const context = buildMemoryContext({
      contextId: 'memctx_strip',
      surface: 'terminal_claude',
      query: 'Redesign landing page',
      docs,
    })
    const wrapped = wrapTaskWithMemory('Redesign landing page', context)

    expect(stripAutomaticMemoryContext(wrapped)).toBe('Redesign landing page')
    expect(stripAutomaticMemoryContext('ordinary user turn')).toBe('ordinary user turn')
  })
})
