import type { ReviewKind } from './memory-review'
import { BAZ_GLOBAL_BRAIN, projectBrain } from './memory-ledger'

/**
 * Canonical, machine-readable Memory policy vocabulary.
 *
 * This module deliberately has no renderer/main-process dependency. Prompts,
 * services, IPC validation, mocks, and UI copy all consume the same values so
 * a trust-sensitive rule cannot silently drift between layers.
 */
export const MEMORY_POLICY_VERSION = 2 as const

export const MEMORY_TRUST_MODES = ['autopilot', 'assisted', 'manual'] as const
export type MemoryTrustMode = (typeof MEMORY_TRUST_MODES)[number]

export const MEMORY_BRAIN_SCOPES = ['project', 'global'] as const
export type MemoryBrainScope = (typeof MEMORY_BRAIN_SCOPES)[number]

export interface MemoryTrustState {
  brain: string
  mode: MemoryTrustMode
  /** False means the mode came from a safe scope default, not a persisted choice. */
  isExplicit: boolean
  policyVersion: number
}

export const PROJECT_DEFAULT_TRUST_MODE: MemoryTrustMode = 'autopilot'
export const GLOBAL_DEFAULT_TRUST_MODE: MemoryTrustMode = 'assisted'

export const MEMORY_TRUST_META: Record<
  MemoryTrustMode,
  { label: string; effect: string }
> = {
  autopilot: {
    label: 'Autopilot',
    effect: 'New facts, safe merges, and reversible cleanup handle themselves. Conflicts always ask.',
  },
  assisted: {
    label: 'Assisted',
    effect: 'Only high-confidence new facts save automatically. Merges and conflicts ask.',
  },
  manual: {
    label: 'Manual',
    effect: 'Every proposed memory waits for review. Human edits remain immediate.',
  },
}

export const MEMORY_SOURCE_CLASSES = [
  'human-edit',
  'agent-summary',
  'transcript',
  'swarm-outcome',
  'council-decision',
  'sentinel-signal',
  'artifact-reference',
  'system-event',
] as const

export const MEMORY_DELEGATED_CONFLICT_BASES = [
  'human-directive',
  'code-verified',
  'source-authority',
  'equivalent-content',
] as const
export type MemoryDelegatedConflictBasis =
  (typeof MEMORY_DELEGATED_CONFLICT_BASES)[number]

export interface DelegatedConflictResolution {
  basis: MemoryDelegatedConflictBasis
  rationale: string
  evidence: string
}

/** Pure validation used by the mutation gateway; transport schemas stay stricter. */
export function delegatedConflictResolutionIssues(
  resolution: Partial<DelegatedConflictResolution> | null | undefined,
): string[] {
  if (!resolution) return ['delegated conflict basis, rationale, and evidence are required']
  const issues: string[] = []
  if (
    !resolution.basis ||
    !(MEMORY_DELEGATED_CONFLICT_BASES as readonly string[]).includes(resolution.basis)
  ) {
    issues.push('delegated conflict basis is invalid; recency is never sufficient')
  }
  if (!resolution.rationale || resolution.rationale.trim().length < 20) {
    issues.push('delegated conflict rationale must explain the judgment')
  }
  if (!resolution.evidence || resolution.evidence.trim().length < 10) {
    issues.push('delegated conflict evidence must identify the authority or verification')
  }
  return issues
}

export const MEMORY_POLICY = {
  version: MEMORY_POLICY_VERSION,
  sourceClasses: MEMORY_SOURCE_CLASSES,
  semanticGate: {
    durabilityRequired: true,
    sourceRequired: true,
    dedupRequired: true,
    secretsRejectedBeforeQueue: true,
    humanEditsBypassSemanticGate: true,
  },
  trust: {
    projectDefault: PROJECT_DEFAULT_TRUST_MODE,
    globalDefault: GLOBAL_DEFAULT_TRUST_MODE,
    modes: MEMORY_TRUST_MODES,
  },
  conflicts: {
    autoResolve: false,
    strategy: 'explicit-review-or-delegated-resolver',
    newerNeverWinsByRecencyAlone: true,
    delegatedResolver: {
      allowedBases: MEMORY_DELEGATED_CONFLICT_BASES,
      rationaleRequired: true,
      evidenceRequired: true,
    },
  },
  lifecycle: {
    archiveRepresentation: 'status:archived',
    forgetRepresentation: 'recoverable-trash',
    hardDelete: false,
  },
  actors: ['user', 'ai', 'system'] as const,
  ledger: {
    requiredForEveryMutation: true,
    beforeAfterHashes: true,
  },
} as const

/** Stable policy lines embedded in the distiller prompt. */
export const MEMORY_POLICY_PROMPT = [
  `Memory policy v${MEMORY_POLICY_VERSION}: precision over recall.`,
  'A conflict is never resolved by recency alone; mark it ask unless an evidence-backed delegated resolver is explicitly used.',
  'Prefer an existing durable fact over a near-duplicate.',
  'Never emit secrets or transient task status as memory.',
].join(' ')

export function isMemoryTrustMode(value: unknown): value is MemoryTrustMode {
  return (
    typeof value === 'string' &&
    (MEMORY_TRUST_MODES as readonly string[]).includes(value)
  )
}

/**
 * Derive an authorized brain from the caller's origin project and an explicit
 * scope. Callers never supply another project's id as the target, so a
 * project-A request cannot address project B's queue by construction.
 */
export function brainForAccess(
  originProjectId: string,
  scope: MemoryBrainScope,
): string {
  if (!originProjectId.trim()) throw new Error('Memory access requires an origin project id.')
  return scope === 'global' ? BAZ_GLOBAL_BRAIN : projectBrain(originProjectId)
}

export function defaultTrustModeForBrain(brain: string): MemoryTrustMode {
  if (brain === BAZ_GLOBAL_BRAIN) return GLOBAL_DEFAULT_TRUST_MODE
  if (brain.startsWith('project:') && brain.length > 'project:'.length) {
    return PROJECT_DEFAULT_TRUST_MODE
  }
  return 'manual'
}

/**
 * Kinds a mode may auto-commit only after the upstream semantic/charter gates
 * have already judged the proposal high quality. This never promotes an
 * unsure review item into a write.
 */
export function autoCommitKinds(mode: MemoryTrustMode): ReadonlySet<ReviewKind> {
  switch (mode) {
    case 'autopilot':
      return new Set<ReviewKind>(['new', 'merge'])
    case 'assisted':
      return new Set<ReviewKind>(['new'])
    case 'manual':
      return new Set<ReviewKind>()
  }
}

export function canAutoCommit(mode: MemoryTrustMode, kind: ReviewKind): boolean {
  return autoCommitKinds(mode).has(kind)
}

/**
 * Whether a mode lets the brain apply REVERSIBLE housekeeping (archive /
 * duplicate-merge maintenance proposals) without asking. Archive is a soft
 * move to `.trash/` and merges keep the survivor + ledger provenance, so
 * autopilot treats them as its own tidy-up; conflicts are never cleanup and
 * stay governed by the explicit-review/delegated-resolver rule.
 */
export function canAutoCleanup(mode: MemoryTrustMode): boolean {
  return mode === 'autopilot'
}
