/**
 * Trust modes for the living brain (renderer-only, no backend collision).
 *
 * The capture pipeline's gate already decides commit/review/skip. Trust mode is
 * a renderer policy layered on top: after a capture, how much of what the brain
 * queued for review should be auto-accepted so Baz doesn't babysit a "save save
 * save" queue while running many agents.
 *
 *  - autopilot: brand-new facts, merges, AND conflicts all save themselves —
 *    recency wins, the newer (already precision-filtered) observation replaces
 *    the old note. (default — the "I trust the brain" mode). Nothing is lost:
 *    every write is ledgered with contentBefore/contentAfter, and `.cockpit-memory`
 *    notes are plain files tracked in this repo's own git history.
 *  - assisted:  only brand-new facts save themselves; merges + conflicts ask.
 *  - manual:    nothing auto-accepts; every gated item waits for Baz.
 *
 * Persisted per project in localStorage. Assisted/manual never auto-accept a
 * conflict — overwriting an existing note there always needs a human decision;
 * autopilot is the one mode that trusts the brain to call it silently.
 */
import type { ReviewKind } from '@shared/memory-review'

export const TRUST_MODES = ['autopilot', 'assisted', 'manual'] as const
export type TrustMode = (typeof TRUST_MODES)[number]

export const DEFAULT_TRUST_MODE: TrustMode = 'autopilot'

/** Human-facing copy for the segmented control + its one-line effect. */
export const TRUST_META: Record<TrustMode, { label: string; effect: string }> = {
  autopilot: {
    label: 'Autopilot',
    effect: 'New facts, merges, and conflicts all save automatically.',
  },
  assisted: {
    label: 'Assisted',
    effect: 'New facts save automatically. Merges and conflicts ask.',
  },
  manual: {
    label: 'Manual',
    effect: 'Nothing saves on its own — you review everything the brain flags.',
  },
}

/** Which review kinds a mode auto-accepts. Only autopilot accepts conflicts. */
export function autoAcceptKinds(mode: TrustMode): Set<ReviewKind> {
  switch (mode) {
    case 'autopilot':
      return new Set<ReviewKind>(['new', 'merge', 'conflict'])
    case 'assisted':
      return new Set<ReviewKind>(['new'])
    case 'manual':
      return new Set<ReviewKind>()
  }
}

const storageKey = (projectId: string): string => `cockpit.memory.trust.${projectId}`

function isTrustMode(value: unknown): value is TrustMode {
  return typeof value === 'string' && (TRUST_MODES as readonly string[]).includes(value)
}

/** Minimal Storage surface we rely on — enough to stay node-typecheck-safe. */
type LocalStorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Reach localStorage via `window` through globalThis so this module typechecks
 * under both the DOM (renderer) and the DOM-less node project that compiles the
 * tests. Returns undefined when there's no window (SSR / node without a stub).
 */
function localStore(): LocalStorageLike | undefined {
  return (globalThis as { window?: { localStorage?: LocalStorageLike } }).window?.localStorage
}

/** Read the saved mode for a project, falling back to the default. Never throws. */
export function readTrustMode(projectId: string): TrustMode {
  try {
    const raw = localStore()?.getItem(storageKey(projectId)) ?? null
    return isTrustMode(raw) ? raw : DEFAULT_TRUST_MODE
  } catch {
    return DEFAULT_TRUST_MODE
  }
}

/** Persist the mode for a project. Never throws (private-mode / mock safe). */
export function writeTrustMode(projectId: string, mode: TrustMode): void {
  try {
    localStore()?.setItem(storageKey(projectId), mode)
  } catch {
    /* localStorage unavailable — mode simply won't persist this session. */
  }
}
