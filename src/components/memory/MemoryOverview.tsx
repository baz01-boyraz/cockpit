import type { MemoryNoteSummary } from '@shared/memory-hub'
import { relativeTime } from '@shared/time'
import { IconChevron, IconMemory } from '../icons'

interface MemoryOverviewProps {
  notes: MemoryNoteSummary[]
  onOpen: (name: string) => void
}

/** Calm landing view: useful orientation instead of an empty reader + raw link queue. */
export function MemoryOverview({ notes, onOpen }: MemoryOverviewProps) {
  const connected = notes.filter((note) => note.linksOut + note.backlinks > 0).length
  const recent = notes.slice(0, 4)

  return (
    <section className="card memory__overview">
      <div className="memoverview__glow" aria-hidden />
      <div className="memoverview__hero">
        <span className="memoverview__icon" aria-hidden>
          <IconMemory width={23} height={23} />
        </span>
        <span className="eyebrow">project brain</span>
        <h3>Your work, remembered without the noise.</h3>
        <p>
          Search the library or open a recent memory. Technical housekeeping stays tucked away
          until it genuinely needs attention.
        </p>
      </div>

      <div className="memoverview__stats" aria-label="Memory summary">
        <div>
          <strong>{notes.length}</strong>
          <span>active memories</span>
        </div>
        <div>
          <strong>{connected}</strong>
          <span>connected ideas</span>
        </div>
      </div>

      <div className="memoverview__recent">
        <div className="memoverview__recentHead">
          <strong>Recently updated</strong>
          <span>Pick up where you left off</span>
        </div>
        <ul>
          {recent.map((note) => (
            <li key={note.name}>
              <button onClick={() => onOpen(note.name)}>
                <span>
                  <strong>{note.title}</strong>
                  <small>{relativeTime(note.updatedAt)}</small>
                </span>
                <IconChevron width={14} height={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
