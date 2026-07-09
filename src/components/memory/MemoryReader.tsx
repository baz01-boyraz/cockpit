import { useEffect, useState } from 'react'
import type { MemoryNote } from '@shared/memory-hub'
import { normalizeNoteName } from '@shared/wikilink'
import { relativeTime } from '@shared/time'
import { IconCheck, IconPlus, IconX } from '../icons'
import { WikiText } from './WikiText'

interface MemoryReaderProps {
  note: MemoryNote
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

/**
 * Center zone: reader (text + clickable wikilinks) and plain-textarea editor.
 * Mount with `key={note.name}` so rename/trash confirm state resets per note.
 */
export function MemoryReader({
  note,
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
          <WikiText content={note.content} known={known} onOpen={onOpenLink} onOffer={onOfferCreate} />
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
