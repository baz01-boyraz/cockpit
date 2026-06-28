import { describe, expect, it } from 'vitest'
import type { ErrorInsight } from '@shared/domain'
import { groupErrors, prettyAuditSummary } from '@shared/dashboard-insights'

function insight(over: Partial<ErrorInsight>): ErrorInsight {
  return {
    id: Math.random().toString(36).slice(2),
    projectId: 'p1',
    logEventId: null,
    title: 'Missing module',
    likelyCause: 'A required package is not installed.',
    suggestedAction: 'Install it.',
    suggestedAgent: 'codex',
    severity: 'high',
    matchedPattern: 'module_not_found',
    createdAt: new Date().toISOString(),
    ...over,
  }
}

describe('groupErrors', () => {
  it('returns an empty array for no errors', () => {
    expect(groupErrors([])).toEqual([])
  })

  it('collapses errors that share a matched pattern and counts them', () => {
    const groups = groupErrors([
      insight({ matchedPattern: 'module_not_found' }),
      insight({ matchedPattern: 'module_not_found' }),
      insight({ matchedPattern: 'port_in_use', title: 'Port already in use', severity: 'medium' }),
    ])

    expect(groups).toHaveLength(2)
    const moduleGroup = groups.find((g) => g.key === 'module_not_found')
    expect(moduleGroup?.count).toBe(2)
    expect(groups.find((g) => g.key === 'port_in_use')?.count).toBe(1)
  })

  it('keeps the highest severity within a group', () => {
    const [group] = groupErrors([
      insight({ severity: 'low' }),
      insight({ severity: 'critical' }),
      insight({ severity: 'medium' }),
    ])

    expect(group.count).toBe(3)
    expect(group.severity).toBe('critical')
  })

  it('sorts groups by descending severity', () => {
    const groups = groupErrors([
      insight({ matchedPattern: 'a', severity: 'low' }),
      insight({ matchedPattern: 'b', severity: 'critical' }),
      insight({ matchedPattern: 'c', severity: 'medium' }),
    ])

    expect(groups.map((g) => g.severity)).toEqual(['critical', 'medium', 'low'])
  })

  it('falls back to the title when no matched pattern is present', () => {
    const [group] = groupErrors([insight({ matchedPattern: '', title: 'Crash' })])
    expect(group.key).toBe('Crash')
  })
})

describe('prettyAuditSummary', () => {
  it('rewrites the routed-task prefix to a terse arrow', () => {
    expect(prettyAuditSummary('Routed task to codex: "fix the import"')).toBe(
      '→ codex: "fix the import"',
    )
  })

  it('is case-insensitive on the prefix', () => {
    expect(prettyAuditSummary('routed task to chat: "hi"')).toBe('→ chat: "hi"')
  })

  it('leaves unrelated summaries untouched', () => {
    expect(prettyAuditSummary('Pushed main to origin')).toBe('Pushed main to origin')
  })
})
