import { useCallback, useEffect, useState } from 'react'
import { cockpit } from '../../lib/cockpit'
import type { MemoryHealth } from '@shared/memory-health'
import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
import type { ReviewItem } from '@shared/memory-review'
import { IconBolt, IconCheck, IconMemory, IconX } from '../icons'

interface MemoryBrainBarProps {
  projectId: string
  /** Called after any write (capture commit or review accept) so the hub reloads. */
  onChanged: () => void
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'The brain hit an error.'
}

/**
 * The living-brain strip (docs/memory-imp.md Phases 2–3): brain health at a
 * glance, a one-tap capture of the latest Claude session, and the review queue
 * where the brain asks Baz about facts it wasn't sure of.
 */
export function MemoryBrainBar({ projectId, onChanged }: MemoryBrainBarProps) {
  const [health, setHealth] = useState<MemoryHealth | null>(null)
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [baz, setBaz] = useState<MemoryHubSnapshot | null>(null)
  const [bazNote, setBazNote] = useState<MemoryNote | null>(null)
  const [showBaz, setShowBaz] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [h, q] = await Promise.all([
        cockpit().memory.health(projectId),
        cockpit().memory.reviewQueue(projectId),
      ])
      setHealth(h)
      setReviews(q)
    } catch (err) {
      setError(msg(err))
    }
  }, [projectId])

  useEffect(() => {
    setHealth(null)
    setReviews([])
    setFlash(null)
    setError(null)
    setEditing(null)
    void refresh()
  }, [refresh])

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
    try {
      const sessions = await cockpit().terminals.claudeSessions(projectId)
      if (sessions.length === 0) {
        setFlash('No Claude sessions found for this project yet.')
        return
      }
      const res = await cockpit().memory.captureSession(projectId, sessions[0].id, false)
      if (res.error) {
        setError(res.error)
        return
      }
      setFlash(
        `Captured: ${res.committed} saved, ${res.queued} to review, ${res.skipped} already known.`,
      )
      await refresh()
      if (res.committed > 0) onChanged()
    } catch (err) {
      setError(msg(err))
    } finally {
      setBusy(false)
    }
  }, [projectId, refresh, onChanged])

  const resolve = useCallback(
    async (item: ReviewItem, decision: 'accept' | 'edit' | 'discard') => {
      setError(null)
      try {
        const content = decision === 'edit' ? editDraft : undefined
        const next = await cockpit().memory.resolveReview(projectId, item.id, decision, content)
        setReviews(next)
        setEditing(null)
        await refresh()
        if (decision !== 'discard') onChanged()
      } catch (err) {
        setError(msg(err))
      }
    },
    [projectId, editDraft, refresh, onChanged],
  )

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

      {flash && <div className="brainbar__flash">{flash}</div>}
      {error && (
        <div className="brainbar__flash brainbar__flash--error" role="alert">
          {error}
        </div>
      )}

      {showBaz && baz && (
        <div className="bazbrain">
          <div className="bazbrain__head">
            <span className="bazbrain__title">Baz brain</span>
            <span className="brainstat"><b>{baz.notes.length}</b> facts about you</span>
          </div>
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
        <ul className="reviewlist">
          {reviews.map((item) => (
            <li key={item.id} className={`reviewcard reviewcard--${item.kind}`}>
              <div className="reviewcard__head">
                <span className="reviewcard__title">{item.title}</span>
                <span className="chip mono reviewcard__kind">{item.kind}</span>
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
      )}
    </section>
  )
}
