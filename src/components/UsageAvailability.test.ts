import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentUsageSnapshot } from '@shared/domain'
import { summarizeAgentUsage } from '@shared/agent-usage'
import { EngineCore } from './UsageStrip'
import { SubscriptionCapacity } from './UsageQuotaRings'

const unavailable: AgentUsageSnapshot = {
  provider: 'claude',
  label: 'Claude',
  available: false,
  plan: null,
  windows: [],
  reason: 'Usage temporarily unavailable.',
  fetchedAt: '2026-07-11T00:00:00.000Z',
}

describe('usage telemetry unavailable copy', () => {
  it('never claims the engine is offline in the compact engine rail', () => {
    const html = renderToStaticMarkup(
      createElement(EngineCore, {
        snapshot: unavailable,
        pill: summarizeAgentUsage(unavailable),
        onOpen: vi.fn(),
      }),
    )

    expect(html).toContain('usage n/a')
    expect(html).toContain('quota telemetry unavailable')
    expect(html.toLowerCase()).not.toContain('offline')
  })

  it('labels the detailed subscription card as usage unavailable, not offline', () => {
    const html = renderToStaticMarkup(createElement(SubscriptionCapacity, { snapshot: unavailable }))

    expect(html).toContain('Usage unavailable')
    expect(html.toLowerCase()).not.toContain('offline')
  })
})
