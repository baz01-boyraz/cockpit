import { useMemo, useState } from 'react'
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

/** Left zone: recency-ordered note list with filter-as-you-type + new note. */
export function MemoryNoteList({ notes, selected, onSelect, onCreate }: MemoryNoteListProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.title.toLowerCase().includes(q) || n.name.includes(q))
  }, [notes, query])

  return (
    <section className="card memory__list">
      <div className="memlist__head">
        <div className="memlist__search">
          <IconSearch width={13} height={13} className="memlist__searchIcon" />
          <input
            className="memlist__searchInput"
            placeholder="Filter notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter notes"
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
            {visible.map((n) => (
              <li key={n.name}>
                <button
                  className={`memnote ${n.name === selected ? 'memnote--active' : ''}`}
                  onClick={() => onSelect(n.name)}
                >
                  <div className="memnote__top">
                    <span className="memnote__title">{n.title}</span>
                    <span className="memnote__time mono">{relativeTime(n.updatedAt)}</span>
                  </div>
                  <div className="memnote__meta">
                    <span className="memnote__name mono">{n.name}</span>
                    <span
                      className={`memnote__count mono ${n.linksOut === 0 ? 'memnote__count--zero' : ''}`}
                      title={`${n.linksOut} outgoing link${n.linksOut === 1 ? '' : 's'}`}
                    >
                      {n.linksOut}→
                    </span>
                    <span
                      className={`memnote__count mono ${n.backlinks === 0 ? 'memnote__count--zero' : ''}`}
                      title={`${n.backlinks} backlink${n.backlinks === 1 ? '' : 's'}`}
                    >
                      ←{n.backlinks}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
