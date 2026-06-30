/**
 * Notepad drawer — a slide-in quick-capture panel anchored beside the left
 * rail. Built for zero-friction idea capture: opens focused on the composer,
 * Enter saves, the list stays glanceable, and deletes are recoverable.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNotepad } from '../store/useNotepad'
import { filterNotes, sortNotes } from '@shared/notepad'
import { NotepadNote } from './NotepadNote'
import { IconNoteClose, IconNoteSearch, IconNoteSpark } from './notepadIcons'

/** Show the search field only once the list is worth searching. */
const SEARCH_THRESHOLD = 5
/** How long the Undo affordance lingers after a delete. */
const UNDO_TIMEOUT_MS = 5000
/** Keep relative timestamps fresh while the drawer is open. */
const TICK_MS = 30_000

/** A clock that only ticks while `active`, to avoid idle re-renders. */
function useTick(active: boolean, intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return now
}

export function NotepadDrawer() {
  const open = useNotepad((s) => s.open)
  const notes = useNotepad((s) => s.notes)
  const query = useNotepad((s) => s.query)
  const editingId = useNotepad((s) => s.editingId)
  const recentlyDeleted = useNotepad((s) => s.recentlyDeleted)
  const toggle = useNotepad((s) => s.toggle)
  const setQuery = useNotepad((s) => s.setQuery)
  const startEdit = useNotepad((s) => s.startEdit)
  const add = useNotepad((s) => s.add)
  const update = useNotepad((s) => s.update)
  const remove = useNotepad((s) => s.remove)
  const togglePin = useNotepad((s) => s.togglePin)
  const undoDelete = useNotepad((s) => s.undoDelete)
  const dismissUndo = useNotepad((s) => s.dismissUndo)

  const [composer, setComposer] = useState('')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const now = useTick(open, TICK_MS)

  // Focus the composer when the drawer opens (after the slide-in paint).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => composerRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  // Esc closes the drawer — but only when not mid-edit (edit owns its own Esc).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editingId) toggle(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editingId, toggle])

  // Auto-retire the Undo affordance.
  useEffect(() => {
    if (!recentlyDeleted) return
    const id = setTimeout(() => dismissUndo(), UNDO_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [recentlyDeleted, dismissUndo])

  const visible = useMemo(() => sortNotes(filterNotes(notes, query)), [notes, query])
  const showSearch = notes.length >= SEARCH_THRESHOLD

  const submit = () => {
    add(composer)
    setComposer('')
    composerRef.current?.focus()
  }

  return (
    <div className={`notepad ${open ? 'notepad--open' : ''}`} aria-hidden={!open}>
      <button
        type="button"
        className="notepad__scrim"
        aria-label="Close notepad"
        tabIndex={open ? 0 : -1}
        onClick={() => toggle(false)}
      />

      <aside className="notepad__panel" role="dialog" aria-label="Notepad" aria-modal="false">
        <header className="notepad__head">
          <div className="notepad__heading">
            <span className="notepad__eyebrow">scratchpad</span>
            <span className="notepad__title">Notepad</span>
          </div>
          <span className="notepad__count mono" aria-hidden>
            {notes.length}
          </span>
          <button
            type="button"
            className="notepad__close"
            onClick={() => toggle(false)}
            aria-label="Close notepad"
            title="Close (Esc)"
          >
            <IconNoteClose width={15} height={15} />
          </button>
        </header>

        <div className="notepad__composer">
          <textarea
            ref={composerRef}
            className="notepad__input"
            placeholder="Capture an idea…"
            value={composer}
            rows={2}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault()
                submit()
              }
            }}
          />
          <div className="notepad__composerFoot">
            <span className="notepad__hint mono">↵ save · ⇧↵ newline</span>
            <button
              type="button"
              className="notepad__save"
              onClick={submit}
              disabled={!composer.trim()}
            >
              Save
            </button>
          </div>
        </div>

        {showSearch && (
          <div className="notepad__search">
            <IconNoteSearch width={14} height={14} className="notepad__searchIcon" />
            <input
              className="notepad__searchInput"
              placeholder="Search notes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                className="notepad__searchClear"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <IconNoteClose width={13} height={13} />
              </button>
            )}
          </div>
        )}

        <div className="notepad__list scroll-y">
          {visible.length === 0 ? (
            <div className="notepad__empty">
              {notes.length === 0 ? (
                <>
                  <span className="notepad__emptyGlyph" aria-hidden>
                    <IconNoteSpark width={22} height={22} />
                  </span>
                  <p className="notepad__emptyTitle">Nothing captured yet</p>
                  <p className="notepad__emptyText">
                    Jot down ideas as they strike — they stay here, on this machine.
                  </p>
                </>
              ) : (
                <p className="notepad__emptyText">No notes match “{query}”.</p>
              )}
            </div>
          ) : (
            visible.map((note) => (
              <NotepadNote
                key={note.id}
                note={note}
                editing={editingId === note.id}
                now={now}
                onStartEdit={() => startEdit(note.id)}
                onCommit={(content) => update(note.id, content)}
                onCancel={() => startEdit(null)}
                onTogglePin={() => togglePin(note.id)}
                onDelete={() => remove(note.id)}
              />
            ))
          )}
        </div>

        {recentlyDeleted && (
          <div className="notepad__undo" role="status">
            <span className="notepad__undoText">Note deleted</span>
            <button type="button" className="notepad__undoBtn" onClick={undoDelete}>
              Undo
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
