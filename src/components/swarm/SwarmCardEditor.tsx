import { useEffect, useMemo, useState } from 'react'
import type { KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'
import type { CouncilResult } from '@shared/council'
import { extractRefinedSpec } from '@shared/council'
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
import { IconCheck, IconCouncil } from '../icons'

export interface SwarmCardPatch {
  title: string
  body: string
  role: string | null
  persona: string | null
  agent: string | null
  assignments: Assignment[]
}

/**
 * The spec-gate wiring the editor drives (Faz 2b). The heavy deliberation
 * (five seats + verdict + scorecard) renders in the panel's wide surface; the
 * editor keeps only the control, the gate decision, and the apply action —
 * whichever card is being edited reads its own slice out of this bundle.
 */
export interface SwarmCouncilGate {
  /** Card id whose spec council is in flight, or null. */
  conveningId: string | null
  /** The latest spec-council result, keyed by the card it judged. */
  result: { cardId: string; result: CouncilResult | null } | null
  /** Send the draft (title + body) to the council as a spec to gate. */
  onConvene: (card: KanbanCard, spec: string) => void
  /** Persist the refined spec as the card body and link the approved session. */
  onApplyRefined: (cardId: string, body: string, sessionId: string) => Promise<void>
}

interface SwarmCardEditorProps {
  card: KanbanCard
  /** Named Agents roster — an optional advanced identity override. */
  agents: NamedAgentSummary[]
  /** Resolves when the update lands; the panel closes the editor on success. */
  onSave: (cardId: string, patch: SwarmCardPatch) => Promise<void>
  onDelete: (cardId: string) => Promise<void>
  onClose: () => void
  /** Spec-gate wiring — convene the council on the draft, then apply its verdict. */
  council: SwarmCouncilGate
}

/**
 * The in-place card editor. The default surface is deliberately minimal:
 * title, body, and the council gate — the swarm auto-assigns agents from the
 * task text at Start, so identity needs no attention on the happy path. The
 * whole "who builds this" machinery (role·spec pipeline + Named Agent
 * override) lives behind one collapsed Advanced section; it opens itself only
 * when the card already carries an explicit pipeline or agent. Picking an
 * agent supersedes the pipeline, and adding a step clears the override.
 */
export function SwarmCardEditor({
  card,
  agents,
  onSave,
  onDelete,
  onClose,
  council,
}: SwarmCardEditorProps) {
  const [title, setTitle] = useState(card.title)
  const [body, setBody] = useState(card.body)
  const [assignments, setAssignments] = useState<Assignment[]>(card.assignments)
  const [agent, setAgent] = useState(card.agent ?? '')
  const [pendRole, setPendRole] = useState<Role>('builder')
  const [pendSpec, setPendSpec] = useState<Spec | ''>('')
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(card.agent) || card.assignments.length > 0,
  )
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState(false)

  const selectedAgent = agent ? (agents.find((a) => a.slug === agent) ?? null) : null
  /** The card may reference an agent whose file has since been removed. */
  const agentMissing = agent !== '' && selectedAgent === null

  const canSave = title.trim().length > 0 && !busy

  // --- spec gate (Faz 2b) ---------------------------------------------------
  const convening = council.conveningId === card.id
  /** The council result belongs to us only when it judged THIS card's spec. */
  const specResult =
    council.result && council.result.cardId === card.id ? council.result.result : null
  const specVerdict = specResult?.specVerdict ?? null
  const refinedSpec = specResult?.verdict ? extractRefinedSpec(specResult.verdict) : null
  const canApply = refinedSpec !== null && Boolean(specResult?.sessionId) && !busy
  /** Council-approved once a session is linked (persisted) or just applied. */
  const approved = applied || card.councilSessionId !== null

  const convene = () => {
    const spec = [title.trim(), body.trim()].filter(Boolean).join('\n\n')
    if (!spec || convening) return
    setApplied(false)
    council.onConvene(card, spec)
  }

  const applyRefined = async () => {
    if (!canApply || !refinedSpec || !specResult?.sessionId) return
    setBusy(true)
    setBody(refinedSpec)
    try {
      await council.onApplyRefined(card.id, refinedSpec, specResult.sessionId)
      setApplied(true)
    } finally {
      setBusy(false)
    }
  }

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

        <div className="swarmGate">
          <div className="swarmGate__head">
            <span className="swarmEdit__label">council</span>
            {approved && (
              <span
                className="swarmTag swarmTag--council"
                title="This card's spec was approved by the LLM council"
              >
                <IconCheck width={10} height={10} aria-hidden /> approved
              </span>
            )}
          </div>

          {convening ? (
            <p className="swarmGate__pending">
              <span className="swarmStart__pulse live-dot" aria-hidden />
              Convening the council — five seats deliberate, then a gate. This takes a few
              minutes; the full verdict lands in the panel above. Keep editing while it runs.
            </p>
          ) : specVerdict ? (
            <div
              className={`swarmGate__verdict swarmGate__verdict--${
                specVerdict.kind === 'approved' ? 'approved' : 'clarify'
              }`}
            >
              <div className="swarmGate__kind">
                {specVerdict.kind === 'approved' ? 'Approved' : 'Needs clarification'}
              </div>
              {specVerdict.kind === 'approved' ? (
                applied ? (
                  <p className="swarmGate__note">
                    Refined spec applied — this card is council-approved.
                  </p>
                ) : (
                  <>
                    <p className="swarmGate__note">
                      {refinedSpec
                        ? 'The council finds this buildable. Apply its refined spec to the body.'
                        : 'Approved, but no refined-spec section was returned — your body stays as written.'}
                    </p>
                    <button
                      className="btn btn--accent btn--sm"
                      onClick={() => void applyRefined()}
                      disabled={!canApply}
                    >
                      Apply refined spec
                    </button>
                  </>
                )
              ) : (
                <>
                  <p className="swarmGate__note">
                    Answer these in the card body, then re-convene:
                  </p>
                  {specVerdict.questions.length > 0 && (
                    <ol className="swarmGate__questions">
                      {specVerdict.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ol>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={convene} disabled={!title.trim()}>
                    <IconCouncil width={11} height={11} aria-hidden /> Re-convene
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <button
                className="btn btn--ghost btn--sm"
                onClick={convene}
                disabled={!title.trim()}
                title="Gate this spec through five advisors before a builder starts"
              >
                <IconCouncil width={11} height={11} aria-hidden /> Convene council
              </button>
              <p className="swarmGate__legend">
                Five advisors gate the spec before a builder starts — approve it, or return the
                questions that would make the build guess.
              </p>
            </>
          )}
        </div>

        <details
          className="swarmEdit__advanced"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="swarmEdit__summary">
            Advanced · who builds this (auto-assigned by default)
          </summary>

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
                  className={`swarmEdit__select${pendSpec ? '' : ' swarmEdit__select--empty'}`}
                  value={pendSpec}
                  onChange={(e) => setPendSpec(e.target.value as Spec | '')}
                  aria-label="Step domain (optional)"
                >
                  <option value="">— domain (optional) —</option>
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
              <p className="swarmEdit__legend">
                <strong>Role</strong> = what the agent does · <strong>Domain</strong> = which area
                it focuses on (optional)
              </p>
            </div>
          )}

          <label className="swarmEdit__row">
            <span className="swarmEdit__label">agent</span>
            <select
              className="swarmEdit__select"
              value={agent}
              onChange={(e) => pickAgent(e.target.value)}
              aria-label="Named agent override"
            >
              <option value="">— none (auto / pipeline) —</option>
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
