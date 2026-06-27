import { describe, expect, it } from 'vitest'
import { needsStrongApproval, requiresApproval, riskLevelFor } from '@shared/approval-rules'

describe('approval rules', () => {
  it('assigns critical risk to force-push and db reset', () => {
    expect(riskLevelFor('git_force_push')).toBe('critical')
    expect(riskLevelFor('database_reset')).toBe('critical')
    expect(needsStrongApproval('git_force_push')).toBe(true)
  })

  it('always requires approval for dangerous actions regardless of config', () => {
    // empty allowlist — defense in depth must still gate these
    expect(requiresApproval('git_force_push', [])).toBe(true)
    expect(requiresApproval('database_reset', [])).toBe(true)
    expect(requiresApproval('deploy', [])).toBe(true)
  })

  it('respects the configured allowlist for non-critical actions', () => {
    expect(requiresApproval('delete_file', [])).toBe(false)
    expect(requiresApproval('delete_file', ['delete_file'])).toBe(true)
  })

  it('does not flag a routine action as strong approval', () => {
    expect(needsStrongApproval('git_push')).toBe(false)
    expect(needsStrongApproval('restart_service')).toBe(false)
  })
})
