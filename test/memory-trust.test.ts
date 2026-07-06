import { afterEach, describe, expect, it } from 'vitest'
import {
  autoAcceptKinds,
  DEFAULT_TRUST_MODE,
  readTrustMode,
  TRUST_META,
  TRUST_MODES,
  writeTrustMode,
} from '../src/lib/memoryTrust'

/** Minimal in-memory localStorage + window stub for the persistence tests. */
function stubStorage(): void {
  const store = new Map<string, string>()
  ;(globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  }
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('autoAcceptKinds', () => {
  it('autopilot auto-accepts new + merge + conflict', () => {
    const set = autoAcceptKinds('autopilot')
    expect(set.has('new')).toBe(true)
    expect(set.has('merge')).toBe(true)
    expect(set.has('conflict')).toBe(true)
  })

  it('assisted auto-accepts only new facts', () => {
    const set = autoAcceptKinds('assisted')
    expect(set.has('new')).toBe(true)
    expect(set.has('merge')).toBe(false)
    expect(set.has('conflict')).toBe(false)
  })

  it('manual auto-accepts nothing', () => {
    expect(autoAcceptKinds('manual').size).toBe(0)
  })

  it('only autopilot auto-accepts a conflict', () => {
    expect(autoAcceptKinds('autopilot').has('conflict')).toBe(true)
    expect(autoAcceptKinds('assisted').has('conflict')).toBe(false)
    expect(autoAcceptKinds('manual').has('conflict')).toBe(false)
  })
})

describe('TRUST_META', () => {
  it('has a label and effect line for every mode', () => {
    for (const mode of TRUST_MODES) {
      expect(TRUST_META[mode].label.length).toBeGreaterThan(0)
      expect(TRUST_META[mode].effect.length).toBeGreaterThan(0)
    }
  })
})

describe('read/writeTrustMode', () => {
  it('falls back to the default when nothing is stored (no window)', () => {
    expect(readTrustMode('proj-x')).toBe(DEFAULT_TRUST_MODE)
    expect(DEFAULT_TRUST_MODE).toBe('autopilot')
  })

  it('round-trips a saved mode per project', () => {
    stubStorage()
    writeTrustMode('proj-a', 'manual')
    writeTrustMode('proj-b', 'assisted')
    expect(readTrustMode('proj-a')).toBe('manual')
    expect(readTrustMode('proj-b')).toBe('assisted')
    expect(readTrustMode('proj-unknown')).toBe(DEFAULT_TRUST_MODE)
  })

  it('ignores a corrupt stored value and returns the default', () => {
    stubStorage()
    const ls = (globalThis as { window?: { localStorage: { setItem(k: string, v: string): void } } })
      .window!.localStorage
    ls.setItem('cockpit.memory.trust.proj-c', 'garbage')
    expect(readTrustMode('proj-c')).toBe(DEFAULT_TRUST_MODE)
  })
})
