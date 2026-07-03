import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
import { IconPlus } from '../icons'

interface MemoryConnectionsProps {
  note: MemoryNote | null
  /** Hub-level unresolved aggregate — shown when no note is selected. */
  unresolved: MemoryHubSnapshot['unresolved']
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
        <span className="memconn__rowName mono">{name}</span>
      </button>
    </li>
  )
}

/**
 * Right zone: this note's backlinks, outgoing links, and unresolved targets
 * (each with a create affordance). With nothing selected it shows the hub-wide
 * unresolved aggregate — the "notes the hub is asking for" worklist.
 */
export function MemoryConnections({ note, unresolved, titles, onOpen, onCreate }: MemoryConnectionsProps) {
  return (
    <aside className="card memory__conns">
      {note ? (
        <>
          <section className="memconn">
            <div className="memconn__head">
              <span className="eyebrow">backlinks</span>
              <span className="memconn__badge mono">{note.backlinks.length}</span>
            </div>
            {note.backlinks.length === 0 ? (
              <div className="memconn__empty">
                Nothing links here yet — reference{' '}
                <span className="mono">[[{note.name}]]</span> from another note.
              </div>
            ) : (
              <ul className="memconn__list">
                {note.backlinks.map((n) => (
                  <ConnectionRow key={n} name={n} title={titles.get(n)} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>

          <section className="memconn">
            <div className="memconn__head">
              <span className="eyebrow">outgoing</span>
              <span className="memconn__badge mono">{note.outgoing.length}</span>
            </div>
            {note.outgoing.length === 0 ? (
              <div className="memconn__empty">No outgoing links.</div>
            ) : (
              <ul className="memconn__list">
                {note.outgoing.map((n) => (
                  <ConnectionRow key={n} name={n} title={titles.get(n)} onOpen={onOpen} />
                ))}
              </ul>
            )}
          </section>

          {note.unresolved.length > 0 && (
            <section className="memconn">
              <div className="memconn__head">
                <span className="eyebrow">unresolved</span>
                <span className="memconn__badge mono">{note.unresolved.length}</span>
              </div>
              <ul className="memconn__list">
                {note.unresolved.map((t) => (
                  <li key={t} className="memconn__missing">
                    <span className="memconn__missingName mono">[[{t}]]</span>
                    <button
                      className="btn btn--ghost btn--sm memconn__create"
                      onClick={() => onCreate(t)}
                      title={`Create ${t}.md`}
                    >
                      <IconPlus width={12} height={12} /> create
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <section className="memconn">
          <div className="memconn__head">
            <span className="eyebrow">wanted notes</span>
            <span className="memconn__badge mono">{unresolved.length}</span>
          </div>
          {unresolved.length === 0 ? (
            <div className="memconn__empty">
              Every [[wikilink]] in this hub resolves. Linked targets that don&rsquo;t exist yet
              will queue up here.
            </div>
          ) : (
            <ul className="memconn__list">
              {unresolved.map((u) => (
                <li key={u.target} className="memconn__missing">
                  <div className="memconn__missingBody">
                    <span className="memconn__missingName mono">[[{u.target}]]</span>
                    <span className="memconn__wantedBy">
                      wanted by {u.wantedBy.length} note{u.wantedBy.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <button
                    className="btn btn--ghost btn--sm memconn__create"
                    onClick={() => onCreate(u.target)}
                    title={`Create ${u.target}.md`}
                  >
                    <IconPlus width={12} height={12} /> create
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </aside>
  )
}
