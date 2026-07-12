import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AutomationJob } from '@shared/automation'
import { AutomationJobCard } from './AutomationsPanel'

const job = (over: Partial<AutomationJob> = {}): AutomationJob => ({
  id: 'auto-1', projectId: 'p1', name: 'Daily briefing', instruction: 'Summarize project health.',
  kind: 'digest', schedule: { kind: 'daily', time: '09:00' }, system: true, enabled: true,
  state: 'scheduled', nextRunAt: '2026-07-13T14:00:00.000Z', lastRunAt: '2026-07-12T14:00:00.000Z',
  lastStatus: 'ok', lastResult: 'Everything is calm.', lastError: null,
  createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T14:00:00.000Z', ...over,
})

describe('AutomationJobCard', () => {
  it('shows the human schedule, last/next run, result, and safe controls', () => {
    const html = renderToStaticMarkup(createElement(AutomationJobCard, {
      job: job(), busy: false, onRun: vi.fn(), onToggle: vi.fn(), onRemove: vi.fn(),
    }))
    expect(html).toContain('Daily briefing')
    expect(html).toContain('Daily at 09:00')
    expect(html).toContain('Last run')
    expect(html).toContain('Next run')
    expect(html).toContain('Everything is calm.')
    expect(html).toContain('Run now')
    expect(html).toContain('Pause')
    expect(html).not.toContain('Delete')
  })

  it('turns a failure into a plain retry state', () => {
    const html = renderToStaticMarkup(createElement(AutomationJobCard, {
      job: job({ lastStatus: 'error', lastResult: null, lastError: 'Hermes was unavailable.' }),
      busy: false, onRun: vi.fn(), onToggle: vi.fn(), onRemove: vi.fn(),
    }))
    expect(html).toContain('Needs attention')
    expect(html).toContain('Hermes was unavailable.')
    expect(html).toContain('Retry now')
  })
})
