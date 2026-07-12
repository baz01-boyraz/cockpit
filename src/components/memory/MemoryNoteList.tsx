import { useEffect, useMemo, useState } from 'react'
import type { MemoryNoteSummary } from '@shared/memory-hub'
import { relativeTime } from '@shared/time'
import { IconPlus, IconSearch, IconX } from '../icons'
import { NoteNameInput } from './NoteNameInput'

interface MemoryNoteListProps {
  notes: MemoryNoteSummary[]
  selected: string | null
  onSelect: (name: string) => void
  onCreate: (slug: string) => Promise<boolean>
}

/** Keep the everyday library intentionally small; search still covers every note. */
const RECENT_LIMIT = 24

/** Left zone: recency-ordered note list with filter-as-you-type + new note. */
export function MemoryNoteList({ notes, selected, onSelect, onCreate }: MemoryNoteListProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.name.includes(q))
  }, [notes, query])

  useEffect(() => setShowAll(false), [notes])

  const searching = query.trim().length > 0
  const shown = searching || showAll ? visible : visible.slice(0, RECENT_LIMIT)
  const hiddenCount = Math.max(0, visible.length - shown.length)

  return (
    <section className="card memory__list">
      <div className="memlist__intro">
        <div>
          <span className="eyebrow">library</span>
          <strong>Memories</strong>
        </div>
        <span className="memlist__total mono">{notes.length}</span>
      </div>
      <div className="memlist__head">
        <div className="memlist__search">
          <IconSearch width={13} height={13} className="memlist__searchIcon" />
          <input
            className="memlist__searchInput"
            placeholder="Find a memory…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a memory"
          />
        </div>
        <button
          className="btn btn--sm memlist__new"
          onClick={() => setCreating((c) => !c)}
          title={creating ? 'Close' : 'New note'}
          aria-label={creating ? 'Close new note input' : 'New note'}
          aria-expanded={creating}
        >
          {creating ? <IconX width={13} height={13} /> : <IconPlus width={13} height={13} />}
          {!creating && 'New'}
        </button>
      </div>

      {creating && (
        <div className="memlist__create">
          <NoteNameInput
            onSubmit={async (slug) => {
              const ok = await onCreate(slug)
              if (ok) setCreating(false)
              return ok
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div className="memlist__body scroll-y">
        {visible.length === 0 ? (
          <div className="emptyline">
            {query ? `Nothing matches “${query}”.` : 'No notes yet.'}
          </div>
        ) : (
          <ul className="memlist">
            {shown.map((n) => (
              <li key={n.name}>
                <button
                  className={`memnote ${n.name === selected ? 'memnote--active' : ''}`}
                  onClick={() => onSelect(n.name)}
                >
                  <div className="memnote__top">
                    <span className="memnote__title">{n.title}</span>
                    <span className="memnote__time">{relativeTime(n.updatedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {!searching && notes.length > RECENT_LIMIT && (
        <div className="memlist__foot">
          <span>{showAll ? `All ${notes.length} memories` : `${hiddenCount} older memories tucked away`}</span>
          <button className="memlist__browse" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show recent' : 'Browse all'}
          </button>
        </div>
      )}
    </section>
  )
}
