import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { IconBolt, IconCheck, IconChevron, IconMemory, IconX } from '../icons'
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
  const [inboxOpen, setInboxOpen] = useState(false)
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)
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
    setInboxOpen(false)
    setActiveReviewId(null)
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
      setFlash(
        res.queued > 0
          ? `Memory found ${res.queued} cleanup suggestion${res.queued === 1 ? '' : 's'}. They are grouped in the inbox.`
          : 'Memory is tidy — no duplicate notes need your attention.',
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
        setActiveReviewId(null)
        await refresh()
        if (decision !== 'discard') onChanged()
      } catch (err) {
        setError(msg(err))
      }
    },
    [projectId, editDraft, refresh, onChanged],
  )

  /** Batch actions are deliberately limited to explicit housekeeping proposals. */
  const resolveMany = useCallback(
    async (targets: ReviewItem[], decision: 'accept' | 'discard') => {
      setError(null)
      setBusy(true)
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
        setBusy(false)
      }
    },
    [projectId, refresh, onChanged],
  )

  const reviewSummary = useMemo(() => summarizeMemoryReviews(reviews), [reviews])
  const cleanupReviews = useMemo(() => reviews.filter(isBatchCleanup), [reviews])
  const requestedReviewIndex = activeReviewId
    ? reviews.findIndex((item) => item.id === activeReviewId)
    : 0
  const activeReviewIndex = requestedReviewIndex >= 0 ? requestedReviewIndex : 0
  const activeReview = reviews[activeReviewIndex] ?? null
  const activePresentation = activeReview ? presentMemoryReview(activeReview) : null
  const inboxHeadline = reviewSummary.attention > 0
    ? `${reviewSummary.attention} memory decision${reviewSummary.attention === 1 ? '' : 's'} need a closer look`
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
          <button className="brainbtn" onClick={() => void consolidate()} disabled={busy} title="Find duplicate memories and tidy their connections">
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
              {reviewSummary.attention > 0 && <span className="memoryInbox__count--attention">{reviewSummary.attention} attention</span>}
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
                  <button onClick={() => moveReview(-1)} aria-label="Previous suggestion" disabled={reviews.length < 2}>
                    <IconChevron width={13} height={13} className="memoryInbox__prev" />
                  </button>
                  <button onClick={() => moveReview(1)} aria-label="Next suggestion" disabled={reviews.length < 2}>
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
                      disabled={busy}
                    >
                      <IconCheck width={13} height={13} /> Apply cleanup
                    </button>
                    <button
                      className="brainbtn brainbtn--ghost brainbtn--sm"
                      onClick={() => void resolveMany(cleanupReviews, 'discard')}
                      disabled={busy}
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

                {activePresentation.rationale && (
                  <div className="memoryDecision__why">
                    <span>Why it surfaced</span>
                    <p>{activePresentation.rationale}</p>
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
                        disabled={busy}
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
                        disabled={busy}
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
                        disabled={busy}
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
