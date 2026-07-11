import {
  MEMORY_POLICY_VERSION,
  brainForAccess,
  defaultTrustModeForBrain,
  isMemoryTrustMode,
  type MemoryBrainScope,
  type MemoryTrustState,
  type MemoryTrustMode,
} from '@shared/memory-policy'
import type { Db } from '../db/Database'

interface SettingsRow {
  trust_mode: string
  policy_version: number
}

/** Main-process source of truth for per-brain Memory trust settings. */
export class MemoryPolicyService {
  constructor(
    private readonly db: Db,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  getTrustMode(originProjectId: string, scope: MemoryBrainScope): MemoryTrustMode {
    return this.getTrustState(originProjectId, scope).mode
  }

  getTrustState(originProjectId: string, scope: MemoryBrainScope): MemoryTrustState {
    const brain = brainForAccess(originProjectId, scope)
    const row = this.db
      .prepare('SELECT trust_mode, policy_version FROM memory_brain_settings WHERE brain = ?')
      .get(brain) as SettingsRow | undefined
    const explicitMode = isMemoryTrustMode(row?.trust_mode) ? row.trust_mode : null
    return {
      brain,
      mode: explicitMode ?? defaultTrustModeForBrain(brain),
      isExplicit: explicitMode !== null,
      policyVersion: row?.policy_version ?? MEMORY_POLICY_VERSION,
    }
  }

  trustModeForBrain(brain: string): MemoryTrustMode {
    const row = this.db
      .prepare('SELECT trust_mode, policy_version FROM memory_brain_settings WHERE brain = ?')
      .get(brain) as SettingsRow | undefined
    return isMemoryTrustMode(row?.trust_mode)
      ? row.trust_mode
      : defaultTrustModeForBrain(brain)
  }

  setTrustMode(
    originProjectId: string,
    scope: MemoryBrainScope,
    mode: MemoryTrustMode,
  ): MemoryTrustMode {
    if (!isMemoryTrustMode(mode)) throw new Error('Invalid Memory trust mode.')
    const brain = brainForAccess(originProjectId, scope)
    this.db
      .prepare(
        `INSERT INTO memory_brain_settings (brain, trust_mode, policy_version, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(brain) DO UPDATE SET
           trust_mode = excluded.trust_mode,
           policy_version = excluded.policy_version,
           updated_at = excluded.updated_at`,
      )
      .run(brain, mode, MEMORY_POLICY_VERSION, this.now())
    return mode
  }
}
