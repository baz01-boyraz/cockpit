/**
 * The sentinel signal spine (Faz A) — the pure, dependency-free core of an
 * always-on, LLM-FREE signal layer. Sensors across the app (log intelligence,
 * swarm worker exits, approvals, council) emit structured {@link SentinelSignal}
 * facts; the main-process `SentinelService` dedups, persists, and pushes them to
 * the renderer plus (for alerts) a macOS notification.
 *
 * This module holds ONLY the shape + the pure rules (fingerprint, suppression,
 * capping/hygiene) so the exact same logic runs in the browser mock and in unit
 * tests. It must stay runtime-dependency-free (no crypto, no node builtins).
 *
 * Severity → delivery contract (the policy the service enforces):
 *   - `info`   → feed only (persisted + `sentinel:alert` event; no toast).
 *   - `notice` → feed + renderer toast.
 *   - `alert`  → feed + toast + macOS notification.
 * A later phase adds LLM triage on top of this spine; the seams (source,
 * severity, fingerprint, context) are shaped for it, but NO LLM is called here.
 */

export type SentinelSeverity = 'info' | 'notice' | 'alert'

export type SentinelSource = 'log-intelligence' | 'worker-exit' | 'approval' | 'council'

export interface SentinelSignal {
  id: string
  projectId: string
  severity: SentinelSeverity
  source: SentinelSource
  title: string
  summary: string
  /**
   * A compact plain-text payload (a log excerpt, a card ref) capped at
   * {@link CONTEXT_CAP} chars and stripped of control characters by
   * {@link buildSignal}. It later seeds a Hermes chat opener, so the cap and the
   * hygiene are load-bearing, not cosmetic.
   */
  context: string | null
  fingerprint: string
  status: 'new' | 'seen'
  createdAt: string
}

/** Default dedup window: a same-fingerprint signal inside this is suppressed. */
export const SENTINEL_COOLDOWN_MS = 10 * 60_000

/** Field caps (chars). Titles/summaries stay notification-sized; context is a
 *  compact excerpt, not a transcript. */
export const TITLE_CAP = 120
export const SUMMARY_CAP = 300
export const CONTEXT_CAP = 2_000

/**
 * Strip C0 control characters (plus DEL) and normalize CRLF. Copied locally to
 * keep this module dependency-free — this is the same hygiene idea as
 * `stripPtyControls` in shared/swarm-worker.ts (a lone CR/ESC in a title or
 * excerpt would corrupt the renderer toast and any downstream prompt).
 */
function stripControls(s: string): string {
  // eslint-disable-next-line no-control-regex -- matching control chars IS the sanitizer's job
  return s.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
}

/** Normalize a title for keying: control-stripped, trimmed, whitespace-collapsed,
 *  lower-cased — so trivially different renderings of the same fact collide. */
function normalizeKey(s: string): string {
  return stripControls(s).replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * A stable, order-independent string key for a signal. Same
 * project + source + (normalized) title always yields the same fingerprint, so
 * a recurring fact dedups. No crypto — collisions across genuinely different
 * titles are acceptable-rare and only cost a suppressed toast, never safety.
 */
export function signalFingerprint(input: {
  projectId: string
  source: SentinelSource
  title: string
}): string {
  return `${input.projectId}::${input.source}::${normalizeKey(input.title)}`
}

/**
 * True when a same-fingerprint signal already exists within the cooldown window
 * ending at `nowIso`. The boundary is EXCLUSIVE at exactly `cooldownMs`: a signal
 * whose age equals the window has expired and no longer suppresses (a fact that
 * recurs right at the window edge deserves to surface again). Empty history and
 * differing fingerprints never suppress.
 */
export function shouldSuppress(
  existing: { fingerprint: string; createdAt: string }[],
  candidate: { fingerprint: string },
  nowIso: string,
  cooldownMs: number,
): boolean {
  const now = Date.parse(nowIso)
  if (Number.isNaN(now)) return false
  for (const e of existing) {
    if (e.fingerprint !== candidate.fingerprint) continue
    const at = Date.parse(e.createdAt)
    if (Number.isNaN(at)) continue
    if (now - at < cooldownMs) return true
  }
  return false
}

/**
 * Build a normalized, capped, control-char-clean {@link SentinelSignal} with a
 * fresh fingerprint and `status: 'new'`. Callers supply the id and createdAt (so
 * this stays free of node/crypto). Title/summary/context are trimmed then hard-
 * capped ({@link TITLE_CAP}/{@link SUMMARY_CAP}/{@link CONTEXT_CAP}); an empty or
 * missing context becomes null.
 */
export function buildSignal(input: {
  id: string
  projectId: string
  severity: SentinelSeverity
  source: SentinelSource
  title: string
  summary: string
  context?: string | null
  createdAt: string
}): SentinelSignal {
  const title = stripControls(input.title).trim().slice(0, TITLE_CAP)
  const summary = stripControls(input.summary).trim().slice(0, SUMMARY_CAP)
  const rawContext = input.context == null ? '' : stripControls(input.context).trim()
  const context = rawContext.length > 0 ? rawContext.slice(0, CONTEXT_CAP) : null
  return {
    id: input.id,
    projectId: input.projectId,
    severity: input.severity,
    source: input.source,
    title,
    summary,
    context,
    fingerprint: signalFingerprint({
      projectId: input.projectId,
      source: input.source,
      title: input.title,
    }),
    status: 'new',
    createdAt: input.createdAt,
  }
}
