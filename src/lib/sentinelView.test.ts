import { describe, expect, it } from 'vitest'
import { importanceMeta, sourceLabel } from './sentinelView'

describe('sentinel source labels', () => {
  it('presents the scheduled sweep in plain language', () => {
    expect(sourceLabel('operational-health')).toBe('operational health')
  })
})

describe('sentinel importance labels', () => {
  it('turns deterministic percentages into plain-language urgency', () => {
    expect(importanceMeta(98)).toEqual({ label: 'Critical', tone: 'critical' })
    expect(importanceMeta(82)).toEqual({ label: 'High', tone: 'high' })
    expect(importanceMeta(64)).toEqual({ label: 'Medium', tone: 'medium' })
    expect(importanceMeta(30)).toEqual({ label: 'Low', tone: 'low' })
  })
})
