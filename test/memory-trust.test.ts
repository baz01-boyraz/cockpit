import { describe, expect, it } from 'vitest'
import {
  autoCommitKinds,
  brainForAccess,
  delegatedConflictResolutionIssues,
  defaultTrustModeForBrain,
  MEMORY_POLICY,
  MEMORY_TRUST_META,
  MEMORY_TRUST_MODES,
} from '../shared/memory-policy'

describe('canonical memory policy', () => {
  it('is machine-readable and locks the trust-sensitive invariants', () => {
    expect(MEMORY_POLICY.version).toBe(2)
    expect(MEMORY_POLICY.semanticGate.humanEditsBypassSemanticGate).toBe(true)
    expect(MEMORY_POLICY.conflicts.autoResolve).toBe(false)
    expect(MEMORY_POLICY.lifecycle.archiveRepresentation).toBe('status:archived')
    expect(MEMORY_POLICY.lifecycle.forgetRepresentation).toBe('recoverable-trash')
    expect(MEMORY_POLICY.actors).toEqual(['user', 'ai', 'system'])
    expect(MEMORY_POLICY.ledger.requiredForEveryMutation).toBe(true)
  })

  it('allows only evidence-backed delegated conflict bases, never recency', () => {
    const delegated = (
      MEMORY_POLICY.conflicts as typeof MEMORY_POLICY.conflicts & {
        delegatedResolver: {
          allowedBases: readonly string[]
          rationaleRequired: boolean
          evidenceRequired: boolean
        }
      }
    ).delegatedResolver

    expect(delegated.allowedBases).toEqual([
      'human-directive',
      'code-verified',
      'source-authority',
      'equivalent-content',
    ])
    expect(delegated.allowedBases).not.toContain('recency')
    expect(delegated.rationaleRequired).toBe(true)
    expect(delegated.evidenceRequired).toBe(true)
  })

  it('rejects forged runtime delegation details even if a caller bypasses the tool schema', () => {
    const issues = delegatedConflictResolutionIssues({
      basis: 'recency' as never,
      rationale: 'too short',
      evidence: 'time',
    })

    expect(issues).toEqual([
      'delegated conflict basis is invalid; recency is never sufficient',
      'delegated conflict rationale must explain the judgment',
      'delegated conflict evidence must identify the authority or verification',
    ])
  })

  it('defaults project brains to Autopilot and the global brain to Assisted', () => {
    expect(defaultTrustModeForBrain('project:proj-a')).toBe('autopilot')
    expect(defaultTrustModeForBrain('baz-global')).toBe('assisted')
  })

  it('lets Autopilot commit high-quality new facts and merges, never conflicts', () => {
    const set = autoCommitKinds('autopilot')
    expect(set.has('new')).toBe(true)
    expect(set.has('merge')).toBe(true)
    expect(set.has('conflict')).toBe(false)
  })

  it('lets Assisted commit high-quality new facts and safe merges while Manual commits nothing', () => {
    expect([...autoCommitKinds('assisted')]).toEqual(['new', 'merge'])
    expect(autoCommitKinds('manual').size).toBe(0)
  })

  it('has stable UI copy for every mode without promising silent conflict resolution', () => {
    for (const mode of MEMORY_TRUST_MODES) {
      expect(MEMORY_TRUST_META[mode].label.length).toBeGreaterThan(0)
      expect(MEMORY_TRUST_META[mode].effect.length).toBeGreaterThan(0)
      expect(MEMORY_TRUST_META[mode].effect.toLowerCase()).not.toContain('conflicts all save')
    }
  })
})

describe('brain access addressing', () => {
  it('derives the target from the origin project plus an explicit scope', () => {
    expect(brainForAccess('proj-a', 'project')).toBe('project:proj-a')
    expect(brainForAccess('proj-a', 'global')).toBe('baz-global')
  })

  it('does not accept an empty origin project', () => {
    expect(() => brainForAccess('', 'project')).toThrow(/origin project/i)
    expect(() => brainForAccess('', 'global')).toThrow(/origin project/i)
  })
})
