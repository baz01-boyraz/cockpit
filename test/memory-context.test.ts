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
  it('gives filesystem-capable agents a compact lookup contract without note bodies', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_test',
      surface: 'terminal_codex',
      query: 'Redesign the landing page hero and visual system',
      docs,
    })

    expect(result.receipt.status).toBe('ready')
    expect(result.receipt.delivery).toBe('lookup')
    expect(result.receipt.notes).toEqual([])
    expect(result.block).toContain('.cockpit-memory/')
    expect(result.block).toMatch(/search|read/i)
    expect(result.block).not.toContain('molten obsidian surfaces, copper accents')
    expect(result.block).not.toContain('Invoices are reconciled')
    expect(result.block.length).toBeLessThan(400)
  })

  it('gives tool-capable Hermes a compact instruction to query memory itself', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_hermes',
      surface: 'hermes_chat',
      query: 'deployment gotcha',
      docs,
    })

    expect(result.receipt.delivery).toBe('lookup')
    expect(result.block).toContain('read_memory_recent')
    expect(result.block).not.toContain('Invoices are reconciled')
  })

  it('inlines at most two short relevant hooks for tool-less council/review surfaces', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_inline',
      surface: 'council_spec',
      query: 'redesign the landing page visual direction',
      docs: [
        ...docs,
        {
          name: 'landing-page-layout',
          updatedAt: '2026-07-10T12:00:00.000Z',
          content: 'Landing page layout keeps the primary CTA above the fold.\n\n' + 'x'.repeat(2_000),
        },
        {
          name: 'landing-page-copy',
          updatedAt: '2026-07-09T12:00:00.000Z',
          content: 'Landing page copy stays direct and concrete.',
        },
      ],
    })

    expect(result.receipt.delivery).toBe('inline')
    expect(result.receipt.notes).toHaveLength(2)
    expect(result.block).toContain('molten obsidian surfaces, copper accents')
    expect(result.block).not.toContain('Invoices are reconciled')
    expect(result.block).not.toContain('x'.repeat(200))
    expect(result.block.length).toBeLessThanOrEqual(1_200)
  })

  it('redacts secret-shaped text from the short inline hook', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_secret',
      surface: 'review_text',
      query: 'deployment token gotcha',
      docs: [
        {
          name: 'deployment-token-gotcha',
          updatedAt: '2026-07-10T12:00:00.000Z',
          content: 'Deployment token sk_live_51H2eKLAbCdEfGh123456 must never leave memory.',
        },
      ],
    })

    expect(result.block).toContain('[REDACTED]')
    expect(result.block).not.toContain('sk_live_')
  })

  it('returns no injected block when a tool-less surface has no relevant match', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_no_match',
      surface: 'council_diff',
      query: 'database migration',
      docs,
    })

    expect(result.receipt.status).toBe('empty')
    expect(result.receipt.delivery).toBe('none')
    expect(result.receipt.notes).toEqual([])
    expect(result.block).toBe('')
    expect(wrapTaskWithMemory('Run the migration', result)).toBe('Run the migration')
  })

  it('returns an explicit empty receipt instead of pretending memory was loaded', () => {
    const result = buildMemoryContext({
      contextId: 'memctx_empty',
      surface: 'council_spec',
      query: 'anything',
      docs: [],
    })

    expect(result.receipt.status).toBe('empty')
    expect(result.receipt.delivery).toBe('none')
    expect(result.receipt.notes).toEqual([])
    expect(result.block).toBe('')
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
    expect(prompt).not.toContain('molten obsidian surfaces, copper accents')
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
