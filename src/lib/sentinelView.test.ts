import { describe, expect, it } from 'vitest'
import { sourceLabel } from './sentinelView'

describe('sentinel source labels', () => {
  it('presents the scheduled sweep in plain language', () => {
    expect(sourceLabel('operational-health')).toBe('operational health')
  })
})
