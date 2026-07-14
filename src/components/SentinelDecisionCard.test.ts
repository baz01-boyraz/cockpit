import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SentinelSignal } from '@shared/sentinel'
import { SentinelDecisionCard } from './SentinelDecisionCard'

const signal = (context: string | null): SentinelSignal => ({
  id: 'sig_1',
  projectId: 'p1',
  severity: 'notice',
  source: 'log-intelligence',
  title: 'Cannot find module',
  summary: 'A required module alias could not be resolved.',
  context,
  fingerprint: 'fp',
  status: 'new',
  createdAt: '2026-07-14T05:00:00.000Z',
  triage: null,
  outcome: null,
  outcomeAt: null,
})

describe('SentinelDecisionCard', () => {
  it('renders the short issue, importance percentage, restart state, and three decisions', () => {
    const html = renderToStaticMarkup(
      createElement(SentinelDecisionCard, {
        signal: signal(null),
        onAsk: vi.fn(),
        onDismiss: vi.fn(),
      }),
    )

    expect(html).toContain('Importance')
    expect(html).toContain('73%')
    expect(html).toContain('Restart unknown')
    expect(html).toContain('Cannot find module')
    expect(html).toContain('A required module alias could not be resolved.')
    expect(html).toContain('Ask Claude')
    expect(html).toContain('Ask Codex')
    expect(html).toContain('Dismiss')
  })

  it('uses safe and required restart tones only when deterministic layer evidence exists', () => {
    const safe = renderToStaticMarkup(
      createElement(SentinelDecisionCard, {
        signal: signal('src/components/Widget.tsx'),
        onAsk: vi.fn(),
        onDismiss: vi.fn(),
      }),
    )
    const required = renderToStaticMarkup(
      createElement(SentinelDecisionCard, {
        signal: signal('electron/main/services/Widget.ts'),
        onAsk: vi.fn(),
        onDismiss: vi.fn(),
      }),
    )

    expect(safe).toContain('signalDecision__restart--safe')
    expect(safe).toContain('No restart')
    expect(required).toContain('signalDecision__restart--required')
    expect(required).toContain('Restart required')
  })
})
