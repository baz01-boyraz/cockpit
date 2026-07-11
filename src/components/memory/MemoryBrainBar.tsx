import { useCallback, useEffect, useRef, useState } from 'react'
import { cockpit } from '../../lib/cockpit'
import type { MemoryHealth } from '@shared/memory-health'
import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
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
import { IconBolt, IconCheck, IconMemory, IconX } from '../icons'

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

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'The brain hit an error.'
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
  const [flash, setFlash] = useState<string | null>(null)
  const [report, setReport] = useState<CaptureReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [baz, setBaz] = useState<MemoryHubSnapshot | null>(null)
  const [bazNote, setBazNote] = useState<MemoryNote | null>(null)
  const [showBaz, setShowBaz] = useState(false)
  const [mode, setMode] = useState<MemoryTrustMode>(PROJECT_DEFAULT_TRUST_MODE)
  const [globalMode, setGlobalMode] = useState<MemoryTrustMode>(GLOBAL_DEFAULT_TRUST_MODE)
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
      const [h, q, projectMode, bazMode] = await Promise.all([
        cockpit().memory.health(projectId),
        loadReviewQueues(),
        loadTrustMode('project'),
        loadTrustMode('global'),
      ])
      if (activeProjectRef.current !== projectId) return
      setHealth(h)
      setReviews(q)
      setMode(projectMode)
      setGlobalMode(bazMode)
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
    setMode(PROJECT_DEFAULT_TRUST_MODE)
    setGlobalMode(GLOBAL_DEFAULT_TRUST_MODE)
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
      } catch (err) {
        if (activeProjectRef.current !== projectId) return
        setError(msg(err))
      }
    },
    [projectId],
  )

  const toggleBaz = useCallback(async () => {
    const next = !showBaz
    setShowBaz(next)
    setBazNote(null)
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
      setBazNote(await cockpit().memory.bazRead(name))
    } catch (err) {
      setError(msg(err))
    }
  }, [])

  const consolidate = useCallback(async () => {
    setBusy(true)
    setError(null)
    setFlash(null)
    setReport(null)
    try {
      const res = await cockpit().memory.consolidate(projectId)
      const { duplicates, oversized, dangling } = res.report
      setFlash(
        `Consolidated: ${res.queued} merges queued · ${duplicates.length} duplicate, ${oversized.length} oversized, ${dangling.length} dangling.`,
      )
      await refresh()
    } catch (err) {
      setError(msg(err))
    } finally {
      setBusy(false)
    }
  }, [projectId, refresh])

  const capture = useCallback(async () => {
    setBusy(true)
    setError(null)
    setFlash(null)
    setReport(null)
    try {
      const sessions = await cockpit().terminals.claudeSessions(projectId)
      if (sessions.length === 0) {
        setFlash('No Claude sessions found for this project yet.')
        return
      }
      const session = sessions[0]
      const beforeIds = new Set(reviews.map((r) => r.id))
      const res = await cockpit().memory.captureSession(projectId, session.id, false)
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

  const resolve = useCallback(
    async (item: ReviewItem, decision: 'accept' | 'edit' | 'discard') => {
      setError(null)
      try {
        const content = decision === 'edit' ? editDraft : undefined
        const scope: MemoryBrainScope = item.brain === BAZ_GLOBAL_BRAIN ? 'global' : 'project'
        await cockpit().memory.resolveReview(projectId, scope, item.id, decision, content)
        setEditing(null)
        await refresh()
        if (decision !== 'discard') onChanged()
      } catch (err) {
        setError(msg(err))
      }
    },
    [projectId, editDraft, refresh, onChanged],
  )

  /** Batch clear the queue. Accept skips conflicts (those need a real decision). */
  const resolveAll = useCallback(
    async (decision: 'accept' | 'discard') => {
      setError(null)
      setBusy(true)
      try {
        const targets =
          decision === 'accept' ? reviews.filter((r) => r.kind !== 'conflict') : reviews
        for (const item of targets) {
          const scope: MemoryBrainScope = item.brain === BAZ_GLOBAL_BRAIN ? 'global' : 'project'
          await cockpit().memory.resolveReview(projectId, scope, item.id, decision)
        }
        setEditing(null)
        await refresh()
        if (decision === 'accept' && targets.length > 0) onChanged()
      } catch (err) {
        setError(msg(err))
      } finally {
        setBusy(false)
      }
    },
    [projectId, reviews, refresh, onChanged],
  )

  const acceptable = reviews.filter((r) => r.kind !== 'conflict').length

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
            <span className="brainstat" title="Notes in the brain">
              <b>{health.noteCount}</b> notes
            </span>
            <span className={`brainstat ${health.orphanCount ? 'brainstat--warn' : ''}`} title="Notes with no links in or out">
              <b>{health.orphanCount}</b> orphan
            </span>
            <span className={`brainstat ${health.unresolvedCount ? 'brainstat--warn' : ''}`} title="Wanted links with no note yet">
              <b>{health.unresolvedCount}</b> unresolved
            </span>
            {reviews.length > 0 && (
              <span className="brainstat brainstat--ask" title="Facts the brain wants you to confirm">
                <b>{reviews.length}</b> to review
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
            title="Facts about you, portable across every project (memory-imp Phase 6)"
          >
            Baz brain
          </button>
          <button className="brainbtn" onClick={() => void consolidate()} disabled={busy} title="Merge duplicates, surface dangling links (memory-imp G5)">
            Consolidate
          </button>
          <button className="brainbtn brainbtn--accent" onClick={() => void capture()} disabled={busy}>
            <IconBolt width={14} height={14} />
            {busy ? 'Capturing…' : 'Capture latest session'}
          </button>
        </div>
      </div>

      <p className="brainbar__mode">{MEMORY_TRUST_META[mode].effect}</p>

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
              <span className="brainstat"><b>{baz.notes.length}</b> facts about you</span>
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
          {baz.notes.length === 0 ? (
            <p className="bazbrain__empty">
              Nothing yet — the brain files a note here when it learns something about how you work.
            </p>
          ) : (
            <div className="bazbrain__grid">
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
              {bazNote && <pre className="reviewcard__pre mono bazbrain__reader">{bazNote.content}</pre>}
            </div>
          )}
        </div>
      )}

      {reviews.length > 0 && (
        <>
          <div className="reviewbatch">
            <span className="reviewbatch__count">
              {reviews.length} to review
              {acceptable < reviews.length ? ` · ${reviews.length - acceptable} conflict` : ''}
            </span>
            <div className="reviewbatch__actions">
              <button
                className="brainbtn brainbtn--accent brainbtn--sm"
                onClick={() => void resolveAll('accept')}
                disabled={busy || acceptable === 0}
                title="Save every non-conflict item at once"
              >
                <IconCheck width={13} height={13} /> Save all{acceptable ? ` (${acceptable})` : ''}
              </button>
              <button
                className="brainbtn brainbtn--ghost brainbtn--sm reviewcard__discard"
                onClick={() => void resolveAll('discard')}
                disabled={busy}
                title="Discard everything in the queue"
              >
                <IconX width={13} height={13} /> Discard all
              </button>
            </div>
          </div>
          <ul className="reviewlist">
            {reviews.map((item) => (
              <li key={item.id} className={`reviewcard reviewcard--${item.kind}`}>
                <div className="reviewcard__head">
                  <span className="reviewcard__title">{item.title}</span>
                  <span>
                    <span className="chip mono reviewcard__kind">
                      {item.brain === BAZ_GLOBAL_BRAIN ? 'baz-global' : 'project'}
                    </span>{' '}
                    <span className="chip mono reviewcard__kind">{item.kind}</span>
                  </span>
                </div>
                <p className="reviewcard__reason">{item.reason}</p>
                {editing === item.id ? (
                  <textarea
                    className="reviewcard__editor mono"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={8}
                    spellCheck={false}
                  />
                ) : (
                  <details className="reviewcard__preview">
                    <summary>Preview note</summary>
                    <pre className="reviewcard__pre mono">{item.proposedContent}</pre>
                  </details>
                )}
                <div className="reviewcard__actions">
                  {editing === item.id ? (
                    <>
                      <button className="brainbtn brainbtn--accent brainbtn--sm" onClick={() => void resolve(item, 'edit')}>
                        <IconCheck width={13} height={13} /> Save edited
                      </button>
                      <button className="brainbtn brainbtn--ghost brainbtn--sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="brainbtn brainbtn--accent brainbtn--sm" onClick={() => void resolve(item, 'accept')}>
                        <IconCheck width={13} height={13} /> Save
                      </button>
                      <button
                        className="brainbtn brainbtn--ghost brainbtn--sm"
                        onClick={() => {
                          setEditing(item.id)
                          setEditDraft(item.proposedContent)
                        }}
                      >
                        Edit
                      </button>
                      <button className="brainbtn brainbtn--ghost brainbtn--sm reviewcard__discard" onClick={() => void resolve(item, 'discard')}>
                        <IconX width={13} height={13} /> Discard
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
