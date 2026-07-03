import { useState } from 'react'
import { IconSwarm } from '../icons'

interface SwarmEmptyStateProps {
  onCreate: (title: string, body: string) => Promise<boolean>
}

/** Empty board: one composed invitation, not dead air (memEmpty pattern). */
export function SwarmEmptyState({ onCreate }: SwarmEmptyStateProps) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const canAdd = title.trim().length > 0 && !busy

  const submit = async () => {
    if (!canAdd) return
    setBusy(true)
    try {
      const ok = await onCreate(title.trim(), '')
      if (ok) setTitle('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card swarmEmpty">
      <div className="swarmEmpty__icon">
        <IconSwarm width={24} height={24} />
      </div>
      <div className="swarmEmpty__title">Cards drive the swarm</div>
      <p className="swarmEmpty__sub">
        Each card is one unit of work an agent can own. Describe the task, drop it in{' '}
        <span className="mono">To do</span>, and press <span className="mono">Start</span> to put
        an agent on it. Up to 3 cards run in parallel, each in its own git worktree — the swarm
        walks them <span className="mono">Running → In review</span> while you stay the reviewer,
        not the typist.
      </p>
      <div className="swarmEmpty__create">
        <input
          className="swarmEmpty__input"
          value={title}
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          aria-label="First card title"
          placeholder="First card — what should get done?"
        />
        <button className="btn btn--accent" onClick={() => void submit()} disabled={!canAdd}>
          {busy ? 'Adding…' : 'Add card'}
        </button>
      </div>
    </div>
  )
}
