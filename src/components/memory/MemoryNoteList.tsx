import { useMemo, useState } from 'react'
import type { MemoryNoteSummary } from '@shared/memory-hub'
import { relativeTime } from '@shared/time'
import { IconPlus, IconSearch, IconX } from '../icons'
import { NoteNameInput } from './NoteNameInput'
import {
  matchingLibraryNotes,
  MEMORY_RECENT_LIMIT,
  shownLibraryNotes,
  type MemoryLibrary,
} from './memoryLibraryModel'

interface MemoryNoteListProps {
  notes: MemoryNoteSummary[]
  selected: string | null
  onSelect: (name: string) => void
  onCreate: (slug: string) => Promise<boolean>
  library: MemoryLibrary
  activeCount: number
  archiveCount: number
  onLibraryChange: (library: MemoryLibrary) => void
}

/** Left zone: recency-ordered note list with filter-as-you-type + new note. */
export function MemoryNoteList({
  notes,
  selected,
  onSelect,
  onCreate,
  library,
  activeCount,
  archiveCount,
  onLibraryChange,
}: MemoryNoteListProps) {
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const visible = useMemo(() => matchingLibraryNotes(notes, query), [notes, query])

  const searching = query.trim().length > 0
  const shown = shownLibraryNotes(notes, query, showAll)
  const hiddenCount = Math.max(0, visible.length - shown.length)

  return (
    <section className="card memory__list">
      <div className="memlist__intro">
        <div>
          <span className="eyebrow">library</span>
          <strong>{library === 'active' ? 'Active memories' : 'Archive'}</strong>
        </div>
        <div className="memlist__scope" role="group" aria-label="Memory library">
          <button
            className={library === 'active' ? 'memlist__scopeBtn memlist__scopeBtn--active' : 'memlist__scopeBtn'}
            onClick={() => onLibraryChange('active')}
            aria-pressed={library === 'active'}
          >
            Active <span className="mono">{activeCount}</span>
          </button>
          <button
            className={library === 'archive' ? 'memlist__scopeBtn memlist__scopeBtn--active' : 'memlist__scopeBtn'}
            onClick={() => onLibraryChange('archive')}
            aria-pressed={library === 'archive'}
          >
            Archive <span className="mono">{archiveCount}</span>
          </button>
        </div>
      </div>
      <div className="memlist__head">
        <div className="memlist__search">
          <IconSearch width={13} height={13} className="memlist__searchIcon" />
          <input
            className="memlist__searchInput"
            placeholder={library === 'active' ? 'Find an active memory…' : 'Find archived history…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find a memory"
          />
        </div>
        {library === 'active' && (
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
        )}
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
            {query
              ? `Nothing matches “${query}”.`
              : library === 'active'
                ? 'No active memories yet.'
                : 'No archived memories.'}
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

      {!searching && notes.length > MEMORY_RECENT_LIMIT && (
        <div className="memlist__foot">
          <span>
            {showAll
              ? `All ${notes.length} ${library === 'active' ? 'active memories' : 'archived memories'}`
              : `${hiddenCount} older ${library === 'active' ? 'memories' : 'history items'} tucked away`}
          </span>
          <button className="memlist__browse" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show recent' : 'Browse all'}
          </button>
        </div>
      )}
    </section>
  )
}
