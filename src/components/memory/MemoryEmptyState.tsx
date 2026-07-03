import { IconMemory } from '../icons'
import { NoteNameInput } from './NoteNameInput'

interface MemoryEmptyStateProps {
  onCreate: (slug: string) => Promise<boolean>
}

/** Empty hub: one composed invitation, not dead air (termEmpty pattern). */
export function MemoryEmptyState({ onCreate }: MemoryEmptyStateProps) {
  return (
    <div className="card memEmpty">
      <div className="memEmpty__icon">
        <IconMemory width={24} height={24} />
      </div>
      <div className="memEmpty__title">Start this project&rsquo;s memory</div>
      <p className="memEmpty__sub">
        Notes live as plain markdown in <span className="mono">.cockpit-memory/</span> next to
        your code — versioned with the repo, readable by you and (soon) your agents. Connect
        them with <span className="mono">[[wikilinks]]</span> and backlinks appear on their own.
      </p>
      <div className="memEmpty__create">
        <NoteNameInput accent autoFocus={false} placeholder="first note name…" onSubmit={onCreate} />
      </div>
    </div>
  )
}
