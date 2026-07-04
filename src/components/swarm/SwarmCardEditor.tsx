import { useEffect, useMemo, useState } from 'react'
import type { KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'
import {
  ROLES,
  SPECS,
  ROLE_IDS,
  SPEC_IDS,
  assignmentLabel,
  type Assignment,
  type Role,
  type Spec,
} from '@shared/agent-taxonomy'
import { classifyRoles } from '@shared/role-router'

export interface SwarmCardPatch {
  title: string
  body: string
  role: string | null
  persona: string | null
  agent: string | null
  assignments: Assignment[]
}

interface SwarmCardEditorProps {
  card: KanbanCard
  /** Named Agents roster — an optional advanced identity override. */
  agents: NamedAgentSummary[]
  /** Resolves when the update lands; the panel closes the editor on success. */
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  onClose: () => void
}

/**
 * The in-place card editor. Identity is a ROLE PIPELINE (systematic taxonomy):
 * an ordered chain of role·spec steps the swarm runs sequentially. Leaving it
 * empty is first-class — the router auto-assigns from the task text at Start
 * (previewed live here). A Named Agent stays available as an advanced override;
 * picking one supersedes the pipeline, and adding a step clears the override.
 */
export function SwarmCardEditor({ card, agents, onSave, onDelete, onClose }: SwarmCardEditorProps) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [assignments, setAssignments] = useState<Assignment[]>(card.assignments)
  const [agent, setAgent] = useState(card.agent ?? '')
  const [pendRole, setPendRole] = useState<Role>('builder')
  const [pendSpec, setPendSpec] = useState<Spec | ''>('')
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(card.agent))
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)

  const selectedAgent = agent ? (agents.find((a) => a.slug === agent) ?? null) : null
  /** The card may reference an agent whose file has since been removed. */
  const agentMissing = agent !== '' && selectedAgent === null

  const canSave = title.trim().length > 0 && !busy

  /** What the router would auto-assign — shown only when nothing is set yet. */
  const autoPreview = useMemo(() => {
    if (agent || assignments.length > 0) return null
    const t = title.trim()
    if (!t) return null
    return classifyRoles(t, body).pipeline.map(assignmentLabel).join(' → ')
  }, [agent, assignments, title, body])

  // An armed delete quietly disarms — no destructive control lingers.
  useEffect(() => {
    if (!deleteArmed) return
    const t = setTimeout(() => setDeleteArmed(false), 4000)
    return () => clearTimeout(t)
  }, [deleteArmed])

  const addStep = () => {
    setAssignments((a) => [...a, { role: pendRole, spec: pendSpec || null }])
    setAgent('') // an explicit pipeline supersedes a named override
    setPendSpec('')
  }

  const removeStep = (index: number) => {
    setAssignments((a) => a.filter((_, i) => i !== index))
  }

  const pickAgent = (slug: string) => {
    setAgent(slug)
    if (slug) setAssignments([]) // a named agent drives its own identity
  }

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
        assignments: agent ? [] : assignments,
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

        {!agent && (
          <div className="swarmEdit__pipeline">
            <span className="swarmEdit__label">pipeline</span>
            {assignments.length > 0 ? (
              <div className="swarmPipeline" role="list" aria-label="Agent pipeline">
                {assignments.map((a, i) => (
                  <span key={`${a.role}-${a.spec ?? ''}-${i}`} className="swarmPipeline__step">
                    {i > 0 && <span className="swarmPipeline__arrow" aria-hidden>›</span>}
                    <span role="listitem" className="swarmTag swarmTag--step swarmTag--removable">
                      {assignmentLabel(a)}
                      <button
                        type="button"
                        className="swarmTag__x"
                        onClick={() => removeStep(i)}
                        aria-label={`Remove ${assignmentLabel(a)} step`}
                      >
                        ×
                      </button>
                    </span>
                  </span>
                ))}
              </div>
            ) : (
              <p className="swarmEdit__hint">
                {autoPreview
                  ? `Unassigned — auto-assign at Start: ${autoPreview}`
                  : 'Unassigned — the swarm picks agents from the task at Start.'}
              </p>
            )}

            <div className="swarmEdit__addStep">
              <select
                className="swarmEdit__select"
                value={pendRole}
                onChange={(e) => setPendRole(e.target.value as Role)}
                aria-label="Step role"
              >
                {ROLE_IDS.map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r].label}
                  </option>
                ))}
              </select>
              <select
                className="swarmEdit__select"
                value={pendSpec}
                onChange={(e) => setPendSpec(e.target.value as Spec | '')}
                aria-label="Step specialisation"
              >
                <option value="">— domain —</option>
                {SPEC_IDS.map((s) => (
                  <option key={s} value={s}>
                    {SPECS[s].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={addStep}
                disabled={assignments.length >= 6}
              >
                + Add step
              </button>
            </div>
          </div>
        )}

        <details
          className="swarmEdit__advanced"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="swarmEdit__summary">Advanced · named agent override</summary>
          <label className="swarmEdit__row">
            <span className="swarmEdit__label">agent</span>
            <select
              className="swarmEdit__select"
              value={agent}
              onChange={(e) => pickAgent(e.target.value)}
              aria-label="Named agent override"
            >
              <option value="">— none (use pipeline) —</option>
              {agentMissing && <option value={agent}>{agent} (missing)</option>}
              {agents.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.displayName}
                  {a.tagline ? ` — ${a.tagline}` : ''}
                </option>
              ))}
            </select>
          </label>
          {agent && (
            <div className="swarmEdit__hint">
              {selectedAgent?.displayName ?? agent} drives identity — the role pipeline is set aside
            </div>
          )}
        </details>

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
