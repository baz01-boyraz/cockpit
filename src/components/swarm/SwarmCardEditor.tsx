import { useEffect, useState } from 'react'
import { AGENT_ROLES, PERSONAS } from '@shared/agent-roles'
import type { KanbanCard } from '@shared/kanban'

/** Assignable agent roles — the shared catalog the worker prompt compiles from. */
const ROLE_IDS = Object.keys(AGENT_ROLES) as (keyof typeof AGENT_ROLES)[]

export interface SwarmCardPatch {
  title: string
  body: string
  role: string | null
  persona: string | null
}

interface SwarmCardEditorProps {
  card: KanbanCard
  /** Resolves when the update lands; the panel closes the editor on success. */
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  onClose: () => void
}

/**
 * The in-place card editor: title, body, role + persona selects, and a delete
 * action with an inline arm/confirm step (never a dialog). Rendered where the
 * card was, so editing never leaves the column. Role = what the worker DOES;
 * persona = the lens it judges through (6.5) — both compile into its prompt.
 */
export function SwarmCardEditor({ card, onSave, onDelete, onClose }: SwarmCardEditorProps) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [role, setRole] = useState(card.role ?? '')
  const [persona, setPersona] = useState(card.persona ?? '')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const canSave = title.trim().length > 0 && !busy

  // An armed delete quietly disarms — no destructive control lingers.
  useEffect(() => {
    if (!deleteArmed) return
    const t = setTimeout(() => setDeleteArmed(false), 4000)
    return () => clearTimeout(t)
  }, [deleteArmed])

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      await onSave(card.id, {
        title: title.trim(),
        body,
        role: role || null,
        persona: persona || null,
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      await onDelete(card.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="swarmCard swarmCard--editing" data-swarm-card>
      <div className="swarmEdit">
        <input
          className="swarmEdit__input"
          value={title}
          autoFocus
          spellCheck={false}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') onClose()
          }}
          aria-label="Card title"
          placeholder="Card title…"
        />
        <textarea
          className="swarmEdit__body"
          value={body}
          rows={3}
          spellCheck={false}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void save()
            if (e.key === 'Escape') onClose()
          }}
          aria-label="Card body"
          placeholder="Details for the agent (optional)…"
        />
        <label className="swarmEdit__row">
          <span className="swarmEdit__label">role</span>
          <select
            className="swarmEdit__select"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Card role"
          >
            <option value="">none</option>
            {ROLE_IDS.map((r) => (
              <option key={r} value={r}>
                {AGENT_ROLES[r].label}
              </option>
            ))}
          </select>
        </label>
        <label className="swarmEdit__row">
          <span className="swarmEdit__label">persona</span>
          <select
            className="swarmEdit__select"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            aria-label="Card persona"
          >
            <option value="">none</option>
            {PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="swarmEdit__actions">
          <button className="btn btn--accent btn--sm" onClick={() => void save()} disabled={!canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn--ghost btn--sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <span className="swarmEdit__spacer" />
          {deleteArmed ? (
            <button className="btn btn--sm swarmEdit__confirm" onClick={() => void remove()} disabled={busy}>
              Delete card?
            </button>
          ) : (
            <button
              className="btn btn--ghost btn--sm btn--danger"
              onClick={() => setDeleteArmed(true)}
              disabled={busy}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
