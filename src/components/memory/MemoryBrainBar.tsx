import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cockpit } from '../../lib/cockpit'
import type { MemoryHealth } from '@shared/memory-health'
import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
import type { LedgerEntry } from '@shared/memory-ledger'
import { parseNote } from '@shared/memory-note-schema'
import type {
  MemoryCaptureOverview,
  MemoryCaptureProviderCoverage,
} from '@shared/memory-capture'
import type { ReviewItem } from '@shared/memory-review'
import {
  GLOBAL_DEFAULT_TRUST_MODE,
  MEMORY_TRUST_META,
  MEMORY_TRUST_MODES,
  PROJECT_DEFAULT_TRUST_MODE,
  isMemoryTrustMode,
  type MemoryBrainScope,
  type MemoryTrustMode,
} from '@shared/memory-policy'
import { BAZ_GLOBAL_BRAIN } from '@shared/memory-ledger'
import { relativeTime } from '@shared/time'
import { summarizeMemoryProvenance } from '../../lib/memoryProvenance'
import { IconBolt, IconCheck, IconChevron, IconMemory, IconX } from '../icons'
import { MemoryChangeHistory, MemorySourceValue } from './MemoryProvenance'
import {
  isBatchCleanup,
  presentMemoryReview,
  summarizeMemoryReviews,
} from '@shared/memory-review-presentation'

interface MemoryBrainBarProps {
  projectId: string
  /** Called after any write (capture commit or review accept) so the hub reloads. */
  onChanged: () => void
}

/** What a capture actually did — the answer to "what did it capture?" */
interface CaptureReport {
  sessionTitle: string
  autoSaved: string[]
  needsReview: string[]
  skipped: number
}

interface NoteActivity {
  history: LedgerEntry[]
  recalls7d: number
  recalls30d: number
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'The brain hit an error.'
}

const captureStageLabel: Record<MemoryCaptureOverview['jobs'][number]['status'], string> = {
  queued: 'Waiting to read',
  reading: 'Reading transcript',
  distilling: 'Finding durable facts',
  reconciling: 'Checking duplicates',
  committing: 'Saving approved facts',
  retry_wait: 'Waiting to retry',
  blocked: 'Needs your help',
  done: 'Captured',
  error: 'Retry needed',
}

function providerState(provider: MemoryCaptureProviderCoverage): string {
  if (provider.blocked > 0) return `${provider.blocked} need${provider.blocked === 1 ? 's' : ''} help`
  if (provider.pending > 0) return `${provider.pending} in progress`
  if (provider.captured > 0) return 'Up to date'
  if (provider.sessions > 0) return 'Ready to learn'
  return 'No sessions yet'
}

function snapshotWhen(id: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id)
  if (!match) return id
  const iso = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`
  const relative = relativeTime(iso)
  return relative === 'now' ? 'just now' : `${relative} ago`
}

const legacyTrustKey = (projectId: string): string => `cockpit.memory.trust.${projectId}`

/** One-time bridge from the renderer-only v1 setting into main-process policy. */
function readLegacyTrustMode(projectId: string): MemoryTrustMode | null {
  try {
    const key = legacyTrustKey(projectId)
    const raw = globalThis.localStorage.getItem(key)
    if (raw === null) return null
    if (isMemoryTrustMode(raw)) return raw
    globalThis.localStorage.removeItem(key)
    return null
  } catch {
    return null
  }
}

function clearLegacyTrustMode(projectId: string): void {
  try {
    globalThis.localStorage.removeItem(legacyTrustKey(projectId))
  } catch {
    // Main-process policy remains authoritative even if legacy cleanup fails.
  }
}

/**
 * The living-brain strip (docs/memory-imp.md Phases 2–3): brain health at a
 * glance, a one-tap capture of the latest Claude session with a plain-language
 * report of what it saved, a trust dial so the brain earns autonomy, and the
 * review queue (with batch actions) where the brain asks Baz about facts it
 * wasn't sure of.
 */
export function MemoryBrainBar({ projectId, onChanged }: MemoryBrainBarProps) {
  const [health, setHealth] = useState<MemoryHealth | null>(null)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [busy, setBusy] = useState(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [report, setReport] = useState<CaptureReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [inboxOpen, setInboxOpen] = useState(false)
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)
  const [baz, setBaz] = useState<MemoryHubSnapshot | null>(null)
  const [bazNote, setBazNote] = useState<MemoryNote | null>(null)
  const [bazActivity, setBazActivity] = useState<NoteActivity | null>(null)
  const [showBaz, setShowBaz] = useState(false)
  const [mode, setMode] = useState<MemoryTrustMode>(PROJECT_DEFAULT_TRUST_MODE)
  const [globalMode, setGlobalMode] = useState<MemoryTrustMode>(GLOBAL_DEFAULT_TRUST_MODE)
  const [captureOverview, setCaptureOverview] = useState<MemoryCaptureOverview | null>(null)
  const [snapshots, setSnapshots] = useState<string[]>([])
  const [retryingJob, setRetryingJob] = useState<string | null>(null)
  const [restoreArmed, setRestoreArmed] = useState<string | null>(null)
  const activeProjectRef = useRef(projectId)

  const loadReviewQueues = useCallback(async (): Promise<ReviewItem[]> => {
    const [projectQueue, globalQueue] = await Promise.all([
      cockpit().memory.reviewQueue(projectId, 'project'),
      cockpit().memory.reviewQueue(projectId, 'global'),
    ])
    return [...projectQueue, ...globalQueue]
  }, [projectId])

  const loadTrustMode = useCallback(
    async (scope: MemoryBrainScope): Promise<MemoryTrustMode> => {
      const state = await cockpit().memory.trustState(projectId, scope)
      if (scope !== 'project' || state.isExplicit) return state.mode
      const legacy = readLegacyTrustMode(projectId)
      if (!legacy) return state.mode
      const migrated = await cockpit().memory.setTrustMode(projectId, scope, legacy)
      clearLegacyTrustMode(projectId)
      return migrated
    },
    [projectId],
  )

  const refresh = useCallback(async () => {
    try {
      const [h, q, projectMode, bazMode, captureState, recoveryPoints] = await Promise.all([
        cockpit().memory.health(projectId),
        loadReviewQueues(),
        loadTrustMode('project'),
        loadTrustMode('global'),
        cockpit().memory.captureStatus(projectId),
        cockpit().memory.snapshots(projectId),
      ])
      if (activeProjectRef.current !== projectId) return
      setHealth(h)
      setReviews(q)
      setMode(projectMode)
      setGlobalMode(bazMode)
      setCaptureOverview(captureState)
      setSnapshots(recoveryPoints)
    } catch (err) {
      if (activeProjectRef.current !== projectId) return
      setError(msg(err))
    }
  }, [loadReviewQueues, loadTrustMode, projectId])

  useEffect(() => {
    activeProjectRef.current = projectId
    setHealth(null)
    setReviews([])
    setFlash(null)
    setReport(null)
    setError(null)
    setEditing(null)
    setReviewBusy(false)
    setInboxOpen(false)
    setActiveReviewId(null)
    setBaz(null)
    setBazNote(null)
    setBazActivity(null)
    setShowBaz(false)
    setMode(PROJECT_DEFAULT_TRUST_MODE)
    setGlobalMode(GLOBAL_DEFAULT_TRUST_MODE)
    setCaptureOverview(null)
    setSnapshots([])
    setRetryingJob(null)
    setRestoreArmed(null)
    void refresh()
  }, [refresh, projectId])

  const changeMode = useCallback(
    async (scope: MemoryBrainScope, next: MemoryTrustMode) => {
      setError(null)
      try {
        await cockpit().memory.setTrustMode(projectId, scope, next)
        if (activeProjectRef.current !== projectId) return
        if (scope === 'global') setGlobalMode(next)
        else setMode(next)
        // Switching into Autopilot settles the reversible-cleanup backlog in
        // the main process — reload the queue and the hub so the inbox and
        // note list reflect what the brain just tidied.
        if (next === 'autopilot') {
          await refresh()
          onChanged()
        }
      } catch (err) {
        if (activeProjectRef.current !== projectId) return
        setError(msg(err))
      }
    },
    [projectId, refresh, onChanged],
  )

  const toggleBaz = useCallback(async () => {
    const next = !showBaz
    setShowBaz(next)
    setBazNote(null)
    setBazActivity(null)
    if (next) {
      try {
        setBaz(await cockpit().memory.bazList())
      } catch (err) {
        setError(msg(err))
      }
    }
  }, [showBaz])

  const openBazNote = useCallback(async (name: string) => {
    try {
      const [note, activity] = await Promise.all([
        cockpit().memory.bazRead(name),
        cockpit().memory.noteActivity(projectId, name, 'global'),
      ])
      if (activeProjectRef.current !== projectId) return
      setBazNote(note)
      setBazActivity(activity)
    } catch (err) {
      if (activeProjectRef.current === projectId) setError(msg(err))
    }
  }, [projectId])

  const consolidate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setFlash(null)
    setReport(null)
    try {
      const res = await cockpit().memory.consolidate(projectId)
      const repetitiveNotes = new Set(res.report.repetitions.map((finding) => finding.slug)).size
      const autoApplied = res.autoApplied ?? 0
      const remaining = Math.max(0, res.queued - autoApplied)
      setFlash(
        autoApplied > 0
          ? `Tidied ${autoApplied} ${autoApplied === 1 ? 'memory' : 'memories'} automatically (Autopilot) — recoverable anytime.${remaining > 0 ? ` ${remaining} need${remaining === 1 ? 's' : ''} your eye in the inbox.` : ''}`
          : res.queued > 0
            ? `Memory found ${res.queued} cleanup suggestion${res.queued === 1 ? '' : 's'}. They are grouped in the inbox.`
            : res.report.repetitions.length > 0
              ? `I found ${res.report.repetitions.length} repeated ${res.report.repetitions.length === 1 ? 'fact' : 'facts'} across ${repetitiveNotes} ${repetitiveNotes === 1 ? 'memory' : 'memories'}. Nothing changed; a safety snapshot is ready.`
              : res.report.oversized.length > 0
                ? `${res.report.oversized.length} long ${res.report.oversized.length === 1 ? 'memory needs' : 'memories need'} a careful split. Nothing changed; a safety snapshot is ready.`
            : 'Memory is tidy — no duplicate notes need your attention.',
      )
      await refresh()
      if (autoApplied > 0) onChanged()
    } catch (err) {
      setError(msg(err))
    } finally {
      setBusy(false)
    }
  }, [projectId, refresh, onChanged])

  const capture = useCallback(async () => {
    setBusy(true)
    setError(null)
    setFlash(null)
    setReport(null)
    try {
      const sessions = await cockpit().terminals.agentSessions(projectId)
      if (sessions.length === 0) {
        setFlash('No Claude or Codex sessions found for this project yet.')
        return
      }
      const session = sessions[0]
      const beforeIds = new Set(reviews.map((r) => r.id))
      const res = await cockpit().memory.captureSession(
        projectId,
        session.provider,
        session.id,
        false,
      )
      if (res.error) {
        setError(res.error)
        return
      }

      // Trust is enforced in the main-process pipeline, including background
      // capture while this panel is unmounted. A queued item is never promoted
      // to a write by renderer convention.
      const queue = await loadReviewQueues()
      const fresh = queue.filter((i) => !beforeIds.has(i.id))
      setReviews(queue)

      const committedTitles = res.proposals.filter((p) => p.gate === 'commit').map((p) => p.title)
      const needsReview = fresh.map((i) => i.title)
      const autoSaved = committedTitles
      setReport({
        sessionTitle: session.title,
        autoSaved,
        needsReview,
        skipped: res.proposals.filter((p) => p.gate === 'skip').length,
      })
      await refresh()
      if (autoSaved.length > 0) onChanged()
    } catch (err) {
      setError(msg(err))
    } finally {
      setBusy(false)
    }
  }, [projectId, loadReviewQueues, refresh, onChanged, reviews])

  const retryCapture = useCallback(async (jobId: string) => {
    setRetryingJob(jobId)
    setError(null)
    setFlash(null)
    try {
      const overview = await cockpit().memory.retryCapture(projectId, jobId)
      if (activeProjectRef.current !== projectId) return
      setCaptureOverview(overview)
      setFlash('Capture retried. Its live stage is shown below.')
      await refresh()
      onChanged()
    } catch (err) {
      if (activeProjectRef.current === projectId) setError(msg(err))
    } finally {
      if (activeProjectRef.current === projectId) setRetryingJob(null)
    }
  }, [onChanged, projectId, refresh])

  const restoreSnapshot = useCallback(async (snapshotId: string) => {
    if (restoreArmed !== snapshotId) {
      setRestoreArmed(snapshotId)
      return
    }
    setBusy(true)
    setError(null)
    setFlash(null)
    try {
      const result = await cockpit().memory.restoreSnapshot(projectId, snapshotId)
      if (activeProjectRef.current !== projectId) return
      setRestoreArmed(null)
      setFlash(`Memory restored. A new safety snapshot (${result.safetySnapshotId}) preserves the state from before this restore.`)
      await refresh()
      onChanged()
    } catch (err) {
      if (activeProjectRef.current === projectId) setError(msg(err))
    } finally {
      if (activeProjectRef.current === projectId) setBusy(false)
    }
  }, [onChanged, projectId, refresh, restoreArmed])

  const resolve = useCallback(
    async (item: ReviewItem, decision: 'accept' | 'edit' | 'discard') => {
      setError(null)
      setReviewBusy(true)
      try {
        const content = decision === 'edit' ? editDraft : undefined
        const scope: MemoryBrainScope = item.brain === BAZ_GLOBAL_BRAIN ? 'global' : 'project'
        await cockpit().memory.resolveReview(projectId, scope, item.id, decision, content)
        setEditing(null)
        setActiveReviewId(null)
        await refresh()
        if (decision !== 'discard') onChanged()
      } catch (err) {
        setError(msg(err))
      } finally {
        setReviewBusy(false)
      }
    },
    [projectId, editDraft, refresh, onChanged],
  )

  /** Batch actions are deliberately limited to explicit housekeeping proposals. */
  const resolveMany = useCallback(
    async (targets: ReviewItem[], decision: 'accept' | 'discard') => {
      setError(null)
      setReviewBusy(true)
      let resolved = 0
      try {
        for (const item of targets) {
          const scope: MemoryBrainScope = item.brain === BAZ_GLOBAL_BRAIN ? 'global' : 'project'
          await cockpit().memory.resolveReview(projectId, scope, item.id, decision)
          resolved += 1
        }
        setEditing(null)
        setActiveReviewId(null)
      } catch (err) {
        setError(msg(err))
      } finally {
        await refresh()
        if (decision === 'accept' && resolved > 0) onChanged()
        setReviewBusy(false)
      }
    },
    [projectId, refresh, onChanged],
  )

  const reviewSummary = useMemo(() => summarizeMemoryReviews(reviews), [reviews])
  const bazProvenance = useMemo(() => {
    const fallback = bazNote ? parseNote(bazNote.content).frontmatter?.session : null
    return summarizeMemoryProvenance(bazActivity?.history ?? [], fallback)
  }, [bazActivity?.history, bazNote])
  const cleanupReviews = useMemo(() => reviews.filter(isBatchCleanup), [reviews])
  const requestedReviewIndex = activeReviewId
    ? reviews.findIndex((item) => item.id === activeReviewId)
    : 0
  const activeReviewIndex = requestedReviewIndex >= 0 ? requestedReviewIndex : 0
  const activeReview = reviews[activeReviewIndex] ?? null
  const activePresentation = activeReview ? presentMemoryReview(activeReview) : null
  const inboxHeadline = reviewSummary.attention > 0
    ? reviewSummary.attention === 1
      ? '1 memory decision needs a closer look'
      : `${reviewSummary.attention} memory decisions need a closer look`
    : reviewSummary.cleanup > 0 && reviewSummary.suggestions > 0
      ? `${reviewSummary.cleanup + reviewSummary.suggestions} waiting — ${reviewSummary.cleanup} cleanup, ${reviewSummary.suggestions} new`
      : reviewSummary.cleanup > 0
        ? `${reviewSummary.cleanup} cleanup suggestion${reviewSummary.cleanup === 1 ? '' : 's'}, neatly grouped`
        : `${reviewSummary.suggestions} memory suggestion${reviewSummary.suggestions === 1 ? '' : 's'}`

  const moveReview = (delta: number) => {
    if (reviews.length === 0) return
    const next = (activeReviewIndex + delta + reviews.length) % reviews.length
    setEditing(null)
    setActiveReviewId(reviews[next].id)
  }

  return (
    <section className="brainbar">
      <div className="brainbar__row">
        <div className="brainbar__lead">
          <span className="brainbar__icon" aria-hidden>
            <IconMemory width={15} height={15} />
          </span>
          <span className="brainbar__title">Living brain</span>
        </div>

        {health && (
          <div className="brainbar__stats" aria-label="Brain health">
            <span className="brainstat" title="Active memories in this project">
              <b>{health.noteCount}</b> memories
            </span>
            {health.orphanCount + health.unresolvedCount === 0 ? (
              <span className="brainstat brainstat--healthy"><IconCheck width={11} height={11} /> tidy</span>
            ) : null}
            {reviews.length > 0 && (
              <span className="brainstat brainstat--ask" title="Suggestions waiting in the Memory inbox">
                <b>{reviews.length}</b> in inbox
              </span>
            )}
          </div>
        )}

        <div className="brainbar__cta">
          <div className="trustseg" role="group" aria-label="How much the brain saves on its own">
            {MEMORY_TRUST_MODES.map((m) => (
              <button
                key={m}
                className={`trustseg__btn ${mode === m ? 'trustseg__btn--active' : ''}`}
                onClick={() => void changeMode('project', m)}
                aria-pressed={mode === m}
                title={MEMORY_TRUST_META[m].effect}
              >
                {MEMORY_TRUST_META[m].label}
              </button>
            ))}
          </div>
          <button
            className={`brainbtn ${showBaz ? 'brainbtn--on' : ''}`}
            onClick={() => void toggleBaz()}
            title="Facts about you that can travel across projects"
          >
            Baz brain
          </button>
          <button className="brainbtn" onClick={() => void consolidate()} disabled={busy || reviewBusy} title="Find duplicate memories and tidy their connections">
            Consolidate
          </button>
          <button className="brainbtn brainbtn--accent" onClick={() => void capture()} disabled={busy || reviewBusy}>
            <IconBolt width={14} height={14} />
            {busy ? 'Capturing…' : 'Capture latest session'}
          </button>
        </div>
      </div>

      <p className="brainbar__mode">{MEMORY_TRUST_META[mode].effect}</p>

      {captureOverview && (
        <section className="captureHealth" aria-label="Claude and Codex memory capture status">
          <div className="captureHealth__providers">
            {captureOverview.providers.map((provider) => (
              <article
                key={provider.provider}
                className={`captureProvider ${provider.blocked > 0 ? 'captureProvider--blocked' : ''}`}
              >
                <div className="captureProvider__head">
                  <strong>{provider.provider === 'claude' ? 'Claude' : 'Codex'}</strong>
                  <span>{providerState(provider)}</span>
                </div>
                <div className="captureProvider__numbers">
                  <span><b>{provider.sessions}</b> sessions</span>
                  <span><b>{provider.captured}</b> captured</span>
                  {provider.lastCapturedAt && (
                    <span>last {relativeTime(provider.lastCapturedAt)}</span>
                  )}
                </div>
              </article>
            ))}
          </div>

          {captureOverview.jobs.some((job) => job.status !== 'done') && (
            <div className="captureJobs">
              {captureOverview.jobs
                .filter((job) => job.status !== 'done')
                .map((job) => (
                  <div className="captureJob" key={job.id}>
                    <span className={`captureJob__dot captureJob__dot--${job.status}`} aria-hidden />
                    <div className="captureJob__copy">
                      <strong>{job.provider === 'claude' ? 'Claude' : 'Codex'} · {captureStageLabel[job.status]}</strong>
                      {job.guidance && <span>{job.guidance}</span>}
                    </div>
                    {(job.status === 'blocked' || job.status === 'error') && (
                      <button
                        className="brainbtn brainbtn--sm"
                        disabled={retryingJob === job.id}
                        onClick={() => void retryCapture(job.id)}
                      >
                        {retryingJob === job.id ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                  </div>
                ))}
            </div>
          )}

          <details className="memoryRecovery">
            <summary>
              Recovery · {snapshots.length} safety snapshot{snapshots.length === 1 ? '' : 's'}
            </summary>
            {snapshots.length === 0 ? (
              <p>No recovery point yet. Consolidate creates one before changing anything.</p>
            ) : (
              <div className="memoryRecovery__list">
                {snapshots.slice(0, 5).map((snapshotId, index) => (
                  <div className="memoryRecovery__row" key={snapshotId}>
                    <div>
                      <strong>{index === 0 ? 'Latest safety point' : 'Earlier safety point'}</strong>
                      <span className="mono">{snapshotWhen(snapshotId)}</span>
                    </div>
                    <button
                      className={`brainbtn brainbtn--sm ${restoreArmed === snapshotId ? 'memoryRecovery__confirm' : ''}`}
                      onClick={() => void restoreSnapshot(snapshotId)}
                      disabled={busy}
                    >
                      {restoreArmed === snapshotId ? 'Confirm restore' : 'Restore'}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {restoreArmed && (
              <p className="memoryRecovery__warning">
                Confirm once more. Cockpit will first save today&rsquo;s state as a new safety snapshot.
              </p>
            )}
          </details>
        </section>
      )}

      {report && (
        <div className="capreport">
          <div className="capreport__head">
            <span className="capreport__title">
              Captured from <span className="capreport__session">{report.sessionTitle}</span>
            </span>
            <button className="capreport__dismiss" onClick={() => setReport(null)} aria-label="Dismiss capture report">
              <IconX width={12} height={12} />
            </button>
          </div>
          {report.autoSaved.length === 0 && report.needsReview.length === 0 ? (
            <p className="capreport__empty">Nothing new — everything here was already in the brain.</p>
          ) : (
            <div className="capreport__groups">
              {report.autoSaved.length > 0 && (
                <div className="capgroup">
                  <div className="capgroup__label capgroup__label--saved">
                    <IconCheck width={12} height={12} /> Saved automatically ({report.autoSaved.length})
                  </div>
                  <ul className="capgroup__list">
                    {report.autoSaved.map((t, i) => (
                      <li key={`s-${i}`}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.needsReview.length > 0 && (
                <div className="capgroup">
                  <div className="capgroup__label capgroup__label--review">
                    Waiting for you ({report.needsReview.length})
                  </div>
                  <ul className="capgroup__list">
                    {report.needsReview.map((t, i) => (
                      <li key={`r-${i}`}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {report.skipped > 0 && (
            <p className="capreport__foot">{report.skipped} already known, skipped.</p>
          )}
        </div>
      )}

      {flash && <div className="brainbar__flash">{flash}</div>}
      {error && (
        <div className="brainbar__flash brainbar__flash--error" role="alert">
          {error}
        </div>
      )}

      {showBaz && baz && (
        <div className="bazbrain">
          <div className="bazbrain__head">
            <div>
              <span className="bazbrain__title">Baz brain</span>
              <span className="brainstat"><b>{baz.notes.length}</b> active facts about you</span>
              {baz.archived.length > 0 && (
                <span className="brainstat"><b>{baz.archived.length}</b> archived</span>
              )}
            </div>
            <div
              className="trustseg"
              role="group"
              aria-label="How much the global Baz brain saves on its own"
            >
              {MEMORY_TRUST_MODES.map((m) => (
                <button
                  key={m}
                  className={`trustseg__btn ${globalMode === m ? 'trustseg__btn--active' : ''}`}
                  onClick={() => void changeMode('global', m)}
                  aria-pressed={globalMode === m}
                  title={MEMORY_TRUST_META[m].effect}
                >
                  {MEMORY_TRUST_META[m].label}
                </button>
              ))}
            </div>
          </div>
          <p className="brainbar__mode">Global policy · {MEMORY_TRUST_META[globalMode].effect}</p>
          {baz.notes.length + baz.archived.length === 0 ? (
            <p className="bazbrain__empty">
              Nothing yet — the brain files a note here when it learns something about how you work.
            </p>
          ) : (
            <div className="bazbrain__grid">
              <div className="bazbrain__library">
                {baz.notes.length === 0 ? (
                  <p className="bazbrain__empty">No active global facts.</p>
                ) : (
                  <ul className="bazbrain__list">
                    {baz.notes.map((n) => (
                      <li key={n.name}>
                        <button
                          className={`bazbrain__item ${bazNote?.name === n.name ? 'bazbrain__item--active' : ''}`}
                          onClick={() => void openBazNote(n.name)}
                        >
                          {n.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {baz.archived.length > 0 && (
                  <details className="bazbrain__archive">
                    <summary>Archive ({baz.archived.length})</summary>
                    <ul className="bazbrain__list">
                      {baz.archived.map((n) => (
                        <li key={n.name}>
                          <button
                            className={`bazbrain__item ${bazNote?.name === n.name ? 'bazbrain__item--active' : ''}`}
                            onClick={() => void openBazNote(n.name)}
                          >
                            {n.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              {bazNote && (
                <div className="bazbrain__detail">
                  <section className="bazbrain__provenance" aria-label="Baz brain memory provenance">
                    <div className="bazbrain__sourceSummary">
                      <span>
                        Created from{' '}
                        {bazProvenance.created ? (
                          <MemorySourceValue source={bazProvenance.created} />
                        ) : (
                          <strong className="memsource memsource--legacy">Not recorded</strong>
                        )}
                      </span>
                      {bazProvenance.latest && (
                        <span>
                          Last changed by <MemorySourceValue source={bazProvenance.latest} />
                        </span>
                      )}
                      <span className="bazbrain__recalls">
                        {bazActivity?.recalls30d ?? 0} recalls in 30 days
                      </span>
                    </div>
                    <MemoryChangeHistory history={bazActivity?.history ?? []} limit={6} />
                  </section>
                  <pre className="reviewcard__pre mono bazbrain__reader">{bazNote.content}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {reviews.length > 0 && (
        <section className={`memoryInbox ${inboxOpen ? 'memoryInbox--open' : ''}`}>
          <button
            className="memoryInbox__toggle"
            onClick={() => setInboxOpen((open) => !open)}
            aria-expanded={inboxOpen}
          >
            <span className="memoryInbox__mark" aria-hidden>
              <IconMemory width={17} height={17} />
            </span>
            <span className="memoryInbox__copy">
              <span className="eyebrow">memory inbox</span>
              <strong>{inboxHeadline}</strong>
              <small>Plain-language choices first. Note text stays hidden until you ask for it.</small>
            </span>
            <span className="memoryInbox__counts" aria-label={`${reviews.length} total suggestions`}>
              {reviewSummary.cleanup > 0 && <span>{reviewSummary.cleanup} cleanup</span>}
              {reviewSummary.attention > 0 && <span className="memoryInbox__count--attention">{reviewSummary.attention} careful review</span>}
              {reviewSummary.suggestions > 0 && <span>{reviewSummary.suggestions} suggestion</span>}
            </span>
            <span className="memoryInbox__openLabel">
              {inboxOpen ? 'Close' : 'Review'}
              <IconChevron
                width={14}
                height={14}
                className={`memoryInbox__chevron ${inboxOpen ? 'memoryInbox__chevron--open' : ''}`}
                aria-hidden
              />
            </span>
          </button>

          {inboxOpen && activeReview && activePresentation && (
            <div className="memoryInbox__body">
              <div className="memoryInbox__toolbar">
                <span className="memoryInbox__progress">
                  Decision {activeReviewIndex + 1} of {reviews.length}
                </span>
                <div className="memoryInbox__nav" aria-label="Move through memory suggestions">
                  <button onClick={() => moveReview(-1)} aria-label="Previous suggestion" disabled={reviews.length < 2 || editing !== null || reviewBusy}>
                    <IconChevron width={13} height={13} className="memoryInbox__prev" />
                  </button>
                  <button onClick={() => moveReview(1)} aria-label="Next suggestion" disabled={reviews.length < 2 || editing !== null || reviewBusy}>
                    <IconChevron width={13} height={13} />
                  </button>
                </div>
              </div>

              {cleanupReviews.length > 1 && (
                <div className="memoryInbox__batch">
                  <div>
                    <strong>Handle the housekeeping together</strong>
                    <span>{cleanupReviews.length} archive or duplicate suggestions — conflicts are never included.</span>
                  </div>
                  <div className="memoryInbox__batchActions">
                    <button
                      className="brainbtn brainbtn--accent brainbtn--sm"
                      onClick={() => void resolveMany(cleanupReviews, 'accept')}
                      disabled={reviewBusy || editing !== null}
                    >
                      <IconCheck width={13} height={13} /> Apply cleanup
                    </button>
                    <button
                      className="brainbtn brainbtn--ghost brainbtn--sm"
                      onClick={() => void resolveMany(cleanupReviews, 'discard')}
                      disabled={reviewBusy || editing !== null}
                    >
                      Keep everything
                    </button>
                  </div>
                </div>
              )}

              <article className={`memoryDecision memoryDecision--${activePresentation.category}`}>
                <div className="memoryDecision__topline">
                  <span className="eyebrow">{activePresentation.eyebrow}</span>
                  <span>{activeReview.brain === BAZ_GLOBAL_BRAIN ? 'Personal memory' : 'This project'}</span>
                </div>
                <h3>{activePresentation.title}</h3>
                <p className="memoryDecision__summary">{activePresentation.summary}</p>

                {(activePresentation.hook || activePresentation.rationale) && (
                  <div className="memoryDecision__facts">
                    {activePresentation.hook && (
                      <div className="memoryDecision__fact">
                        <span>What it says</span>
                        <p>“{activePresentation.hook}”</p>
                      </div>
                    )}
                    {activePresentation.rationale && (
                      <div className="memoryDecision__fact">
                        <span>Why it surfaced</span>
                        <p>{activePresentation.rationale}</p>
                      </div>
                    )}
                  </div>
                )}

                {editing === activeReview.id ? (
                  <textarea
                    className="reviewcard__editor mono"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={9}
                    spellCheck={false}
                    aria-label="Edit proposed memory"
                  />
                ) : (
                  <details className="memoryDecision__details">
                    <summary>See note details</summary>
                    {activeReview.kind === 'conflict' && activeReview.existingContent ? (
                      <div className="memoryDecision__compare">
                        <div>
                          <span>Current memory</span>
                          <pre className="reviewcard__pre mono">{activeReview.existingContent}</pre>
                        </div>
                        <div>
                          <span>New version</span>
                          <pre className="reviewcard__pre mono">{activeReview.proposedContent}</pre>
                        </div>
                      </div>
                    ) : (
                      <pre className="reviewcard__pre mono">{activeReview.proposedContent}</pre>
                    )}
                  </details>
                )}

                <div className="memoryDecision__actions">
                  {editing === activeReview.id ? (
                    <>
                      <button
                        className="brainbtn brainbtn--accent brainbtn--sm"
                        onClick={() => void resolve(activeReview, 'edit')}
                        disabled={reviewBusy}
                      >
                        <IconCheck width={13} height={13} /> Save adjusted text
                      </button>
                      <button className="brainbtn brainbtn--ghost brainbtn--sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="brainbtn brainbtn--accent brainbtn--sm"
                        onClick={() => void resolve(activeReview, 'accept')}
                        disabled={reviewBusy}
                      >
                        <IconCheck width={13} height={13} /> {activePresentation.acceptLabel}
                      </button>
                      {activePresentation.canEdit && (
                        <button
                          className="brainbtn brainbtn--ghost brainbtn--sm"
                          onClick={() => {
                            setEditing(activeReview.id)
                            setEditDraft(activeReview.proposedContent)
                          }}
                        >
                          Adjust text
                        </button>
                      )}
                      <button
                        className="brainbtn brainbtn--ghost brainbtn--sm reviewcard__discard"
                        onClick={() => void resolve(activeReview, 'discard')}
                        disabled={reviewBusy}
                      >
                        <IconX width={13} height={13} /> {activePresentation.discardLabel}
                      </button>
                    </>
                  )}
                </div>
              </article>
            </div>
          )}
        </section>
      )}
    </section>
  )
}
