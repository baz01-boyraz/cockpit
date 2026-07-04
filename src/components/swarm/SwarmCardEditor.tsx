import { useEffect, useState } from 'react'
import type { KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'

export interface SwarmCardPatch {
  title: string
  body: string
  role: string | null
  persona: string | null
  agent: string | null
}

interface SwarmCardEditorProps {
  card: KanbanCard
  /** Named Agents roster — the identity a card carries. */
  agents: NamedAgentSummary[]
  /** Resolves when the update lands; the panel closes the editor on success. */
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  onClose: () => void
}

/**
 * The in-place card editor: title, body, one agent select, and a delete
 * action with an inline arm/confirm step (never a dialog). Rendered where
 * the card was, so editing never leaves the column. A Named Agent is a full
 * identity — role and persona live in the agent's definition file, so the
 * editor never offers them as separate controls. Saving always nulls the
 * legacy manual role/persona columns; identity comes from the agent alone.
 */
export function SwarmCardEditor({ card, agents, onSave, onDelete, onClose }: SwarmCardEditorProps) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [agent, setAgent] = useState(card.agent ?? '')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const agentPicked = agent !== ''
  const selectedAgent = agentPicked ? (agents.find((a) => a.slug === agent) ?? null) : null
  /** The card may reference an agent whose file has since been removed. */
  const agentMissing = agentPicked && selectedAgent === null

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
        role: null,
        persona: null,
        agent: agent || null,
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
          <span className="swarmEdit__label">agent</span>
          <select
            className="swarmEdit__select"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            aria-label="Card agent"
          >
            <option value="">Unassigned</option>
            {agentMissing && <option value={agent}>{agent} (missing)</option>}
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.displayName}
                {a.tagline ? ` — ${a.tagline}` : ''}
              </option>
            ))}
          </select>
        </label>
        {agentPicked && (
          <div className="swarmEdit__hint">
            Role &amp; persona come from {selectedAgent?.displayName ?? agent}&rsquo;s definition
          </div>
        )}
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
