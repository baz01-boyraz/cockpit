import { describe, expect, it } from 'vitest'
import {
  HERMES_RUNTIME_ENABLED,
  assertHermesRuntimeEnabled,
} from '../shared/hermes-runtime'

describe('Hermes runtime suspension', () => {
  it('keeps the Hermes runtime hard-disabled', () => {
    expect(HERMES_RUNTIME_ENABLED).toBe(false)
  })

  it('rejects every Hermes execution path before a process can spawn', () => {
    expect(() => assertHermesRuntimeEnabled()).toThrow(/Hermes is paused/i)
  })
})
