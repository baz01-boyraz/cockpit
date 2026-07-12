import type { MemoryNote } from '@shared/memory-hub'
import { IconPlus } from '../icons'

interface MemoryConnectionsProps {
  note: MemoryNote
  /** slug → title, for friendly labels on connection rows. */
  titles: ReadonlyMap<string, string>
  onOpen: (name: string) => void
  onCreate: (target: string) => void
}

function ConnectionRow({
  name,
  title,
  onOpen,
}: {
  name: string
  title: string | undefined
  onOpen: (name: string) => void
}) {
  return (
    <li>
      <button className="memconn__row" onClick={() => onOpen(name)} title={`Open ${name}`}>
        <span className="memconn__rowTitle">{title ?? name}</span>
      </button>
    </li>
  )
}

/**
 * Right zone: only the selected note's useful relationships. Hub-wide missing
 * links stay out of the everyday view so implementation details never become a
 * fake to-do list for the owner.
 */
export function MemoryConnections({ note, titles, onOpen, onCreate }: MemoryConnectionsProps) {
  const connectionCount = note.backlinks.length + note.outgoing.length

  return (
    <aside className="card memory__conns">
      <div className="memconn__overview">
        <span className="eyebrow">connections</span>
        <strong>{connectionCount === 0 ? 'This memory stands on its own' : `${connectionCount} nearby memories`}</strong>
        <p>{connectionCount === 0 ? 'Connections appear naturally when notes mention each other.' : 'Open a related memory without losing your place.'}</p>
      </div>

      {note.backlinks.length > 0 && (
          <section className="memconn">
            <div className="memconn__head">
              <span className="eyebrow">mentioned in</span>
              <span className="memconn__badge mono">{note.backlinks.length}</span>
            </div>
              <ul className="memconn__list">
                {note.backlinks.map((n) => (
                  <ConnectionRow key={n} name={n} title={titles.get(n)} onOpen={onOpen} />
                ))}
              </ul>
          </section>
      )}

      {note.outgoing.length > 0 && (
          <section className="memconn">
            <div className="memconn__head">
              <span className="eyebrow">links to</span>
              <span className="memconn__badge mono">{note.outgoing.length}</span>
            </div>
              <ul className="memconn__list">
                {note.outgoing.map((n) => (
                  <ConnectionRow key={n} name={n} title={titles.get(n)} onOpen={onOpen} />
                ))}
              </ul>
          </section>
      )}

      {note.unresolved.length > 0 && (
        <details className="memconn__advanced">
          <summary>{note.unresolved.length} unfinished link{note.unresolved.length === 1 ? '' : 's'}</summary>
            <section className="memconn">
              <p className="memconn__empty">These names were mentioned in this note, but do not have their own memory yet.</p>
              <ul className="memconn__list">
                {note.unresolved.map((t) => (
                  <li key={t} className="memconn__missing">
                    <span className="memconn__missingName">{t.replace(/[-_.]+/g, ' ')}</span>
                    <button
                      className="btn btn--ghost btn--sm memconn__create"
                      onClick={() => onCreate(t)}
                      title={`Create ${t}.md`}
                    >
                      <IconPlus width={12} height={12} /> Add
                    </button>
                  </li>
                ))}
              </ul>
            </section>
        </details>
      )}
    </aside>
  )
}
