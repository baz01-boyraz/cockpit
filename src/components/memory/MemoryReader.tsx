import { useEffect, useMemo, useState } from 'react'
import type { MemoryNote } from '@shared/memory-hub'
import type { LedgerEntry } from '@shared/memory-ledger'
import {
  noteLifecycle,
  parseNote,
  type NoteAuthority,
} from '@shared/memory-note-schema'
import { normalizeNoteName } from '@shared/wikilink'
import { relativeTime } from '@shared/time'
import { summarizeMemoryProvenance } from '../../lib/memoryProvenance'
import { IconCheck, IconPlus, IconX } from '../icons'
import { NoteBody } from './NoteBody'
import { MemoryChangeHistory, MemorySourceValue } from './MemoryProvenance'

interface MemoryReaderProps {
  note: MemoryNote
  activity: {
    history: LedgerEntry[]
    recalls7d: number
    recalls30d: number
  } | null
  mode: 'read' | 'edit'
  draft: string
  saving: boolean
  /** One brief lime moment after a successful save. */
  savedFlash: boolean
  /** Unresolved link the user clicked — offer creation, never auto-create. */
  pendingCreate: string | null
  known: ReadonlySet<string>
  onDraftChange: (value: string) => void
  onEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
  onRename: (to: string) => void
  onTrash: () => void
  onOpenLink: (name: string) => void
  onOfferCreate: (target: string) => void
  onCreatePending: () => void
  onDismissPending: () => void
}

/** "just now" / "4m ago" — same honest labelling as the Logs panel. */
function updatedLabel(iso: string): string {
  const t = relativeTime(iso)
  return t === 'now' ? 'just now' : `${t} ago`
}

const AUTHORITY_LABEL: Record<NoteAuthority, string> = {
  'human-directive': 'Owner approved',
  'code-verified': 'Verified in code',
  'source-authority': 'Authoritative source',
  'equivalent-content': 'Equivalent evidence',
  observed: 'Observed',
  'model-inference': 'Model inference',
  legacy: 'Legacy / manual',
}

function shortEvidence(value: string): string {
  return value.length > 42 ? `${value.slice(0, 18)}…${value.slice(-12)}` : value
}

/**
 * Center zone: reader (text + clickable wikilinks) and plain-textarea editor.
 * Mount with `key={note.name}` so rename/trash confirm state resets per note.
 */
export function MemoryReader({
  note,
  activity,
  mode,
  draft,
  saving,
  savedFlash,
  pendingCreate,
  known,
  onDraftChange,
  onEdit,
  onSave,
  onCancelEdit,
  onRename,
  onTrash,
  onOpenLink,
  onOfferCreate,
  onCreatePending,
  onDismissPending,
}: MemoryReaderProps) {
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(note.name)
  const [trashArmed, setTrashArmed] = useState(false)
  const renameSlug = normalizeNoteName(renameValue)
  const renameValid = renameSlug !== null && renameSlug !== note.name
  const parsed = useMemo(() => parseNote(note.content), [note.content])
  const lifecycle = useMemo(() => noteLifecycle(parsed.frontmatter), [parsed.frontmatter])
  const provenance = useMemo(
    () => summarizeMemoryProvenance(activity?.history ?? [], parsed.frontmatter?.session),
    [activity?.history, parsed.frontmatter?.session],
  )
  const evidenceRef = parsed.frontmatter?.authorityRef ?? parsed.frontmatter?.session ?? null
  const reviewOverdue = lifecycle.reviewAfter
    ? Date.parse(lifecycle.reviewAfter) < Date.now()
    : false

  // A primed trash button quietly disarms — no destructive control lingers.
  useEffect(() => {
    if (!trashArmed) return
    const t = setTimeout(() => setTrashArmed(false), 4000)
    return () => clearTimeout(t)
  }, [trashArmed])

  const commitRename = () => {
    if (!renameValid) return
    setRenaming(false)
    onRename(renameSlug)
  }

  return (
    <section className="card memory__reader">
      <div className="memreader__head">
        <div className="memreader__headText">
          {renaming ? (
            <div className="memreader__rename">
              <input
                className="memreader__renameInput mono"
                value={renameValue}
                autoFocus
                spellCheck={false}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                aria-label="New name for this note"
              />
              <button className="btn btn--sm" onClick={commitRename} disabled={!renameValid}>
                <IconCheck width={12} height={12} /> Rename
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h3 className="memreader__title">{note.title}</h3>
              <div className="memreader__sub mono">
                {note.name}.md · updated {updatedLabel(note.updatedAt)}
              </div>
            </>
          )}
          {renaming && (
            <div className="memreader__renameHint">
              renaming refreshes every [[{note.name}]] link across the hub
            </div>
          )}
        </div>

        {!renaming && (
          <div className="memreader__actions">
            {/* A save switches to read mode, so the confirmation lives here — not
                buried in the edit branch where it could never appear. */}
            {savedFlash && (
              <span className="memreader__saved">
                <IconCheck width={12} height={12} /> saved
              </span>
            )}
            {mode === 'read' ? (
              <>
                <button className="btn btn--sm" onClick={onEdit}>
                  Edit
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setRenaming(true)}>
                  Rename
                </button>
                {trashArmed ? (
                  <button
                    className="btn btn--sm memreader__trashConfirm"
                    onClick={onTrash}
                    title="Nothing is deleted — the file moves into .cockpit-memory/.trash/"
                  >
                    Move to .trash?
                  </button>
                ) : (
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => setTrashArmed(true)}
                    title="Moves to .trash — recoverable"
                  >
                    Trash
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn btn--accent btn--sm" onClick={onSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={onCancelEdit} disabled={saving}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {trashArmed && mode === 'read' && (
        <div className="memreader__trashNote">moves to .trash — recoverable, never deleted</div>
      )}

      {mode === 'read' && (
        <div className="memreader__trustline" aria-label="Memory trust metadata">
          <span className={`memtrust memtrust--${lifecycle.status}`}>{lifecycle.status}</span>
          <span className="memtrust">{AUTHORITY_LABEL[lifecycle.authority]}</span>
          <span className="memtrust">{lifecycle.confidence} confidence</span>
          <span className="memtrust">{lifecycle.scope === 'global' ? 'All projects' : 'This project'}</span>
          {reviewOverdue && <span className="memtrust memtrust--review">Review due</span>}
        </div>
      )}

      {mode === 'read' && (
        <div className="memreader__sourceLine" aria-label="Memory source provenance">
          <span>
            Created from{' '}
            {provenance.created ? (
              <MemorySourceValue source={provenance.created} />
            ) : (
              <strong className="memsource memsource--legacy">Not recorded</strong>
            )}
          </span>
          {provenance.latest && (
            <span>
              Last changed by <MemorySourceValue source={provenance.latest} />
            </span>
          )}
        </div>
      )}

      {pendingCreate && (
        <div className="memoffer">
          <span className="memoffer__text">
            <span className="mono">[[{pendingCreate}]]</span> doesn&rsquo;t exist yet.
          </span>
          <button className="btn btn--sm" onClick={onCreatePending}>
            <IconPlus width={12} height={12} /> Create note
          </button>
          <button
            className="btn btn--ghost btn--sm"
            onClick={onDismissPending}
            aria-label="Dismiss create offer"
          >
            <IconX width={12} height={12} />
          </button>
        </div>
      )}

      {mode === 'read' ? (
        <div className="memreader__body scroll-y">
          <details className="memreader__evidence">
            <summary>
              <span>Evidence &amp; history</span>
              <span>
                {activity?.recalls30d ?? 0} recalls in 30 days · {activity?.history.length ?? 0} changes
              </span>
            </summary>
            <div className="memreader__evidenceGrid">
              <div className="memreader__evidenceFacts">
                <div><span>Authority</span><strong>{AUTHORITY_LABEL[lifecycle.authority]}</strong></div>
                <div><span>Confidence</span><strong>{lifecycle.confidence}</strong></div>
                <div><span>Scope</span><strong>{lifecycle.scope === 'global' ? 'All projects' : 'This project'}</strong></div>
                <div><span>Recalls</span><strong>{activity?.recalls7d ?? 0} / 7d · {activity?.recalls30d ?? 0} / 30d</strong></div>
                {lifecycle.lastVerifiedAt && (
                  <div><span>Verified</span><strong>{updatedLabel(lifecycle.lastVerifiedAt)}</strong></div>
                )}
                {lifecycle.reviewAfter && (
                  <div>
                    <span>Next review</span>
                    <strong className={reviewOverdue ? 'memreader__overdue' : ''}>
                      {reviewOverdue ? 'due now' : updatedLabel(lifecycle.reviewAfter)}
                    </strong>
                  </div>
                )}
                {evidenceRef && (
                  <div><span>Evidence ref</span><strong className="mono" title={evidenceRef}>{shortEvidence(evidenceRef)}</strong></div>
                )}
              </div>
              <MemoryChangeHistory history={activity?.history ?? []} />
            </div>
          </details>
          <NoteBody
            content={note.content}
            known={known}
            onOpen={onOpenLink}
            onOffer={onOfferCreate}
            dedupeTitle={note.title}
          />
        </div>
      ) : (
        <div className="memreader__editWrap">
          <textarea
            className="memedit mono"
            value={draft}
            autoFocus
            spellCheck={false}
            onChange={(e) => onDraftChange(e.target.value)}
            aria-label={`Edit ${note.name}`}
          />
          <div className="memedit__hint mono">markdown · connect notes with [[wikilinks]]</div>
        </div>
      )}
    </section>
  )
}
