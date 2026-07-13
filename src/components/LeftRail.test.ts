import { describe, expect, it } from 'vitest'
import { LEFT_RAIL_NAV } from './LeftRail'

describe('left rail navigation', () => {
  it('does not expose Automations or Railway destinations', () => {
    const destinations = LEFT_RAIL_NAV.map((item) => item.view)

    expect(destinations).not.toContain('automations')
    expect(destinations).not.toContain('railway')
  })
})
