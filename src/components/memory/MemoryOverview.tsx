import type { MemoryNoteSummary } from '@shared/memory-hub'
import { relativeTime } from '@shared/time'
import { IconChevron, IconMemory } from '../icons'

interface MemoryOverviewProps {
  notes: MemoryNoteSummary[]
  onOpen: (name: string) => void
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Working landing view: what the brain holds, what moved recently, and which
 * memories everything else hangs off — every element opens something. No
 * marketing hero; orientation the user can act on.
 */
export function MemoryOverview({ notes, onOpen }: MemoryOverviewProps) {
  const degree = (note: MemoryNoteSummary): number => note.linksOut + note.backlinks
  const connected = notes.filter((note) => degree(note) > 0).length
  const freshCount = notes.filter(
    (note) => Date.now() - Date.parse(note.updatedAt) < WEEK_MS,
  ).length
  const recent = notes.slice(0, 5)
  const hubs = [...notes]
    .filter((note) => degree(note) > 0)
    .sort((a, b) => degree(b) - degree(a))
    .slice(0, 5)

  return (
    <section className="card memory__overview">
      <header className="memoverview__head">
        <span className="memoverview__icon" aria-hidden>
          <IconMemory width={20} height={20} />
        </span>
        <div className="memoverview__intro">
          <span className="eyebrow">project brain</span>
          <h3>Everything this project has learned, in one place.</h3>
          <p>
            Plain markdown saved with the repo. Open a memory below, search the library, or
            switch to <strong>Graph</strong> to see how the ideas connect.
          </p>
        </div>
        <dl className="memoverview__stats" aria-label="Memory summary">
          <div>
            <dt>memories</dt>
            <dd>{notes.length}</dd>
          </div>
          <div>
            <dt>connected</dt>
            <dd>{connected}</dd>
          </div>
          <div>
            <dt>updated this week</dt>
            <dd>{freshCount}</dd>
          </div>
        </dl>
      </header>

      <div className="memoverview__grid">
        <div className="memoverview__col">
          <div className="memoverview__colHead">
            <strong>Recently updated</strong>
            <span>Pick up where you left off</span>
          </div>
          <ul>
            {recent.map((note) => (
              <li key={note.name}>
                <button onClick={() => onOpen(note.name)}>
                  <span className="memoverview__rowText">
                    <strong>{note.title}</strong>
                    <small>{note.name}.md</small>
                  </span>
                  <span className="memoverview__rowMeta mono">{relativeTime(note.updatedAt)}</span>
                  <IconChevron width={13} height={13} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="memoverview__col">
          <div className="memoverview__colHead">
            <strong>Most connected</strong>
            <span>The load-bearing ideas</span>
          </div>
          {hubs.length === 0 ? (
            <p className="memoverview__empty">
              No links yet — connect notes with [[wikilinks]] and the hubs appear here.
            </p>
          ) : (
            <ul>
              {hubs.map((note) => (
                <li key={note.name}>
                  <button onClick={() => onOpen(note.name)}>
                    <span className="memoverview__rowText">
                      <strong>{note.title}</strong>
                      <small>{note.name}.md</small>
                    </span>
                    <span className="memoverview__rowMeta mono">{degree(note)} links</span>
                    <IconChevron width={13} height={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
