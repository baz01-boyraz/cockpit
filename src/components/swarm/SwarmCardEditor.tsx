import { useEffect, useState } from 'react'
import { AGENT_ROLES, PERSONAS } from '@shared/agent-roles'
import type { KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'

/** Assignable agent roles — the shared catalog the worker prompt compiles from. */
const ROLE_IDS = Object.keys(AGENT_ROLES) as (keyof typeof AGENT_ROLES)[]

export interface SwarmCardPatch {
  title: string
  body: string
  role: string | null
  persona: string | null
  agent: string | null
}

interface SwarmCardEditorProps {
  card: KanbanCard
  /** Named Agents roster — the identities a card can carry instead of a manual role/persona. */
  agents: NamedAgentSummary[]
  /** Resolves when the update lands; the panel closes the editor on success. */
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  onClose: () => void
}

/**
 * The in-place card editor: title, body, agent + role + persona selects, and
 * a delete action with an inline arm/confirm step (never a dialog). Rendered
 * where the card was, so editing never leaves the column. A Named Agent is a
 * full identity — while one is picked, the manual role/persona rows give way
 * to a single hint line (the agent's definition supplies both; never three
 * identity controls at once). Role = what the worker DOES; persona = the
 * lens it judges through (6.5).
 */
export function SwarmCardEditor({ card, agents, onSave, onDelete, onClose }: SwarmCardEditorProps) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [agent, setAgent] = useState(card.agent ?? '')
  const [role, setRole] = useState(card.role ?? '')
  const [persona, setPersona] = useState(card.persona ?? '')
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  /** While an agent carries the identity, manual role/persona are moot. */
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
        role: role || null,
        persona: persona || null,
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
            <option value="">None (manual role/persona)</option>
            {agentMissing && <option value={agent}>{agent} (missing)</option>}
            {agents.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.displayName}
                {a.tagline ? ` — ${a.tagline}` : ''}
              </option>
            ))}
          </select>
        </label>
        {agentPicked ? (
          <div className="swarmEdit__hint">
            Role &amp; persona come from {selectedAgent?.displayName ?? agent}&rsquo;s definition
          </div>
        ) : (
          <>
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
          </>
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
