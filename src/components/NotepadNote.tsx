/**
 * A single note: glanceable card in view mode, inline textarea in edit mode.
 * The parent owns all note state; this component is presentational + local
 * draft only.
 */
import { useEffect, useRef, useState } from 'react'
import { relativeTime } from '@shared/time'
import type { Note } from '@shared/notepad'
import { IconNotePin, IconNoteTrash } from './notepadIcons'

interface NotepadNoteProps {
  note: Note
  editing: boolean
  /** Shared "now" for relative timestamps; ticks while the drawer is open. */
  now: number
  onStartEdit: () => void
  onCommit: (content: string) => void
  onCancel: () => void
  onTogglePin: () => void
  onDelete: () => void
}

export function NotepadNote({
  note,
  editing,
  now,
  onStartEdit,
  onCommit,
  onCancel,
  onTogglePin,
  onDelete,
}: NotepadNoteProps) {
  const [draft, setDraft] = useState(note.content)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Guards against the commit-on-blur firing twice (once on Enter/Esc, then
  // again as the unmounting textarea loses focus).
  const doneRef = useRef(false)

  useEffect(() => {
    if (!editing) return
    doneRef.current = false
    setDraft(note.content)
    const el = ref.current
    if (el) {
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [editing, note.content])

  const finish = (commit: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit) onCommit(draft)
    else onCancel()
  }

  if (editing) {
    return (
      <div className="noteCard noteCard--editing">
        <textarea
          ref={ref}
          className="noteCard__editor"
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              finish(true)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              finish(false)
            }
          }}
        />
        <div className="noteCard__editHint mono">↵ save · ⇧↵ newline · esc cancel</div>
      </div>
    )
  }

  return (
    <div className={`noteCard ${note.pinned ? 'noteCard--pinned' : ''}`}>
      <button type="button" className="noteCard__body" onClick={onStartEdit} title="Edit note">
        <p className="noteCard__text">{note.content}</p>
      </button>
      <div className="noteCard__foot">
        <span className="noteCard__time mono">{relativeTime(note.updatedAt, now)}</span>
        <div className="noteCard__actions">
          <button
            type="button"
            className={`noteCard__act ${note.pinned ? 'noteCard__act--on' : ''}`}
            onClick={onTogglePin}
            aria-pressed={note.pinned}
            title={note.pinned ? 'Unpin' : 'Pin to top'}
          >
            <IconNotePin width={14} height={14} />
          </button>
          <button
            type="button"
            className="noteCard__act noteCard__act--danger"
            onClick={onDelete}
            title="Delete note"
          >
            <IconNoteTrash width={14} height={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
