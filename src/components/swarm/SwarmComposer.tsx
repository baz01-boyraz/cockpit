import { useState } from 'react'

interface SwarmComposerProps {
  /** Resolves true when the card lands — the composer then closes itself. */
  onCreate: (title: string, body: string) => Promise<boolean>
  onCancel: () => void
}

/**
 * Inline "new card" form at the foot of the To do column. Title is required
 * (Enter submits); the body is optional (Cmd/Ctrl+Enter submits). Escape closes.
 */
export function SwarmComposer({ onCreate, onCancel }: SwarmComposerProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const canAdd = title.trim().length > 0 && !busy

  const submit = async () => {
    if (!canAdd) return
    setBusy(true)
    try {
      const ok = await onCreate(title.trim(), body.trim())
      if (ok) onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="swarmCompose">
      <input
        className="swarmCompose__input"
        value={title}
        autoFocus
        spellCheck={false}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onCancel()
        }}
        aria-label="New card title"
        placeholder="What should get done?"
      />
      <textarea
        className="swarmCompose__body"
        value={body}
        rows={2}
        spellCheck={false}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
          if (e.key === 'Escape') onCancel()
        }}
        aria-label="New card details"
        placeholder="Details for the agent (optional)…"
      />
      <div className="swarmCompose__actions">
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn--accent btn--sm" onClick={() => void submit()} disabled={!canAdd}>
          {busy ? 'Adding…' : 'Add card'}
        </button>
      </div>
    </div>
  )
}
