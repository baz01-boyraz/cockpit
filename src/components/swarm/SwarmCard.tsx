import { useEffect, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import type { KanbanCard } from '@shared/kanban'
import type { NamedAgentSummary } from '@shared/named-agents'
import type { DiffStat } from '@shared/review'
import { assignmentLabel } from '@shared/agent-taxonomy'
import { cockpit } from '../../lib/cockpit'
import { useCardCompletion, useSessionActivity } from '../../store/swarmActivityStore'
import {
  IconBranch,
  IconCheck,
  IconCouncil,
  IconPause,
  IconPlay,
  IconShieldSearch,
  IconTerminal,
} from '../icons'

/** 6.2–6.5 per-card actions, grouped so board/column signatures stay small. */
export interface SwarmCardActions {
  /** Card id with a startCard call in flight, if any. */
  startingId: string | null
  /** Card id with a parkCard call in flight, if any. */
  parkingId: string | null
  /** Card id with a diff review in flight, if any. */
  reviewingId: string | null
  /** Card id with a council run in flight, if any. */
  councilingId: string | null
  /** Card id with a completion-report fetch in flight, if any. */
  reportingId: string | null
  /** Card whose Start hit the council spec gate — shows the inline gate prompt. */
  gatedId: string | null
  /** Start (or Resume) a card; `skipGate` is the developer escape past the gate. */
  onStart: (cardId: string, opts?: { skipGate?: boolean }) => void
  /** Gate prompt primary action — convene the council on this card's draft. */
  onConveneGate: (card: KanbanCard) => void
  onPark: (cardId: string) => void
  onViewTerminal: () => void
  onReview: (card: KanbanCard) => void
  onCouncil: (card: KanbanCard) => void
  onReport: (card: KanbanCard) => void
}

/** Deterministic identity hue. An agent's own declared color wins; otherwise
 * the card's manual role decides; an unassigned card stays neutral graphite. */
type IdentityTone = 'ember' | 'copper' | 'glacier' | 'signal' | 'violet' | 'neutral'

const AGENT_COLOR_TONE: Record<string, IdentityTone> = {
  ember: 'ember',
  copper: 'copper',
  glacier: 'glacier',
  signal: 'signal',
}

const ROLE_TONE: Record<string, IdentityTone> = {
  builder: 'ember',
  reviewer: 'glacier',
  planner: 'violet',
  scout: 'signal',
  fixer: 'copper',
  tester: 'signal',
  copywriter: 'copper',
}

/** Agent color declaration → the matching accent-tint chip class. */
const AGENT_TINTS: Record<string, string> = {
  ember: 'swarmTag--agentEmber',
  copper: 'swarmTag--agentCopper',
  glacier: 'swarmTag--agentGlacier',
  signal: 'swarmTag--agentSignal',
}

/** Status → the surface's state-energy modifier (running is the hero). */
const STATUS_CLASS: Record<KanbanCard['status'], string> = {
  todo: 'swarmCard--todo',
  in_progress: 'swarmCard--running',
  in_review: 'swarmCard--review',
  done: 'swarmCard--done',
  parked: 'swarmCard--parked',
}

interface CardIdentity {
  tone: IdentityTone
  /** Single-glyph monogram for the header plate. */
  monogram: string
}

/** The header plate's hue + monogram, resolved from agent → role → unassigned. */
function resolveIdentity(card: KanbanCard, agent: NamedAgentSummary | null): CardIdentity {
  if (agent) {
    return {
      tone: (agent.color ? AGENT_COLOR_TONE[agent.color] : undefined) ?? 'ember',
      monogram: (agent.displayName.trim().charAt(0) || '•').toUpperCase(),
    }
  }
  const leadRole = card.assignments[0]?.role ?? card.role
  if (leadRole) {
    return {
      tone: ROLE_TONE[leadRole] ?? 'neutral',
      monogram: leadRole.trim().charAt(0).toUpperCase() || '•',
    }
  }
  return { tone: 'neutral', monogram: '•' }
}

interface SwarmCardProps {
  card: KanbanCard
  /** The card's Named Agent from the roster, or null (manual role / unknown slug). */
  agent: NamedAgentSummary | null
  /** True while this card is the one being dragged (dimmed in place). */
  dragging: boolean
  /** Position in its column — drives the staggered mount entrance. */
  index: number
  /** True while startCard is in flight for THIS card. */
  starting: boolean
  /** True while parkCard is in flight for THIS card. */
  parking: boolean
  /** True while a diff review is running for THIS card. */
  reviewing: boolean
  /** True while a council run is live for THIS card. */
  counciling: boolean
  /** True while a completion-report fetch is live for THIS card. */
  reporting: boolean
  /** True when THIS card's Start hit the council spec gate (show the prompt). */
  gated: boolean
  onDragStart: (card: KanbanCard) => void
  onDragEnd: () => void
  onOpen: (cardId: string) => void
  /** 6.2 — spawn a worker (To do / Parked cards only). `skipGate` overrides the gate. */
  onStart: (cardId: string, opts?: { skipGate?: boolean }) => void
  /** Gate prompt primary action — convene the council on this card's draft. */
  onConveneGate: (card: KanbanCard) => void
  /** 6.3 — stop the worker, keep the worktree (Running cards only). */
  onPark: (cardId: string) => void
  /** Jump to the Terminals view (Running cards only). */
  onViewTerminal: () => void
  /** Run the AI diff review (In review cards only). */
  onReview: (card: KanbanCard) => void
  /** 6.5 — run the reviewer council: every persona lens over the same diff. */
  onCouncil: (card: KanbanCard) => void
  /** Faz 2.5 — fetch the decision-ready completion report (In review cards only). */
  onReport: (card: KanbanCard) => void
}

const startable = (status: KanbanCard['status']): boolean =>
  status === 'todo' || status === 'parked'

/** Output younger than this reads as "actively working". */
const FRESH_OUTPUT_MS = 15_000
/** Relative-age refresh cadence while a card is running. */
const ACTIVITY_TICK_MS = 5_000

/** A clock that only ticks while `active` — idle cards never re-render. */
function useNow(active: boolean, intervalMs: number): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNowMs(Date.now())
    const timer = setInterval(() => setNowMs(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [active, intervalMs])
  return nowMs
}

/** "output 3s ago" / "quiet 4m" — the at-a-glance liveness readout. */
function activityLabel(lastAt: number | null, nowMs: number): string {
  if (lastAt === null) return 'awaiting output…'
  const age = Math.max(0, nowMs - lastAt)
  if (age < 8_000) return 'output just now'
  if (age < 60_000) return `output ${Math.round(age / 1000)}s ago`
  return `quiet ${Math.round(age / 60_000)}m`
}

/**
 * The Running card's liveness row: a lit dot + relative last-output time fed
 * by the app-level heartbeat, so "is the worker alive?" reads from the board
 * without opening the terminal.
 */
function RunningActivity({ sessionId }: { sessionId: string | null }) {
  const lastAt = useSessionActivity(sessionId)
  const nowMs = useNow(true, ACTIVITY_TICK_MS)
  const fresh = lastAt !== null && nowMs - lastAt < FRESH_OUTPUT_MS
  return (
    <div className="swarmActivity" role="status">
      <span
        className={`swarmActivity__dot ${fresh ? 'swarmActivity__dot--live' : ''}`}
        aria-hidden
      />
      <span className="swarmActivity__label mono">{activityLabel(lastAt, nowMs)}</span>
    </div>
  )
}

/**
 * The worktree's change summary — a cheap `+N −M · K files` badge so an In
 * review / Parked card says WHAT the worker actually did without opening the
 * terminal. LLM-free (a git shortstat), fetched once per worktree; a clean or
 * missing worktree renders nothing rather than a noisy zero.
 */
function ReviewStat({ projectId, dir }: { projectId: string; dir: string }) {
  const [stat, setStat] = useState<DiffStat | null>(null)
  useEffect(() => {
    let alive = true
    cockpit()
      .review.diffStat(projectId, { dir })
      .then((s) => alive && setStat(s))
      .catch(() => alive && setStat(null))
    return () => {
      alive = false
    }
  }, [projectId, dir])
  if (!stat || stat.files === 0) return null
  return (
    <div
      className="swarmStat"
      role="status"
      aria-label={`${stat.files} file${stat.files === 1 ? '' : 's'} changed, ${stat.insertions} added, ${stat.deletions} removed`}
    >
      <span className="swarmStat__add mono">+{stat.insertions}</span>
      <span className="swarmStat__del mono">−{stat.deletions}</span>
      <span className="swarmStat__files">
        {stat.files} file{stat.files === 1 ? '' : 's'}
      </span>
    </div>
  )
}

/** The at-a-glance status glyph pinned to the header's right edge. Running keeps
 * its pinging ember live dot (the hero); every other lane gets a quiet tinted
 * pip so an idle card still reads its stage without a hover. */
function statusGlyph(status: KanbanCard['status']): ReactNode {
  switch (status) {
    case 'in_progress':
      return <span className="swarmCard__live live-dot" title="Agent running" aria-hidden />
    case 'in_review':
      return (
        <span className="swarmCard__stat swarmCard__stat--review" aria-hidden>
          <IconShieldSearch width={11} height={11} />
        </span>
      )
    case 'done':
      return (
        <span className="swarmCard__stat swarmCard__stat--done" aria-hidden>
          <IconCheck width={11} height={11} />
        </span>
      )
    case 'parked':
      return (
        <span className="swarmCard__stat swarmCard__stat--parked" aria-hidden>
          <IconPause width={10} height={10} />
        </span>
      )
    default:
      return <span className="swarmCard__stat swarmCard__stat--todo" aria-hidden />
  }
}

/**
 * One board card, redesigned as a mission-control tile that reads as premium
 * even at rest. Anatomy is fixed on EVERY card: a header strip (a hue-tinted
 * identity plate keyed to the agent/role, a stronger title, a status glyph at
 * the right), a muted body preview, a meta row (identity name chip + a crisp
 * mono branch pill), and a hairline-separated footer of actions. The card
 * itself always carries a lit-lip gradient border, a layered resting shadow
 * and a surface gradient, so it floats above the lane without needing hover.
 * Running is the one hero: an ember gradient border, a breathing bloom, a
 * header shimmer and a pinging live dot (all opacity/transform, reduced-motion
 * gated). Per-status footers: Start/Resume (molten — THE action), Park + View
 * terminal while Running, Review diff + Council once In review. A parked card
 * that kept its worktree says "Resume" and flags the kept worktree. Click (or
 * Enter/Space) opens the inline editor; the whole card is draggable; action
 * clicks never bubble into the editor.
 */
export function SwarmCard({
  card,
  agent,
  dragging,
  index,
  starting,
  parking,
  reviewing,
  counciling,
  reporting,
  gated,
  onDragStart,
  onDragEnd,
  onOpen,
  onStart,
  onConveneGate,
  onPark,
  onViewTerminal,
  onReview,
  onCouncil,
  onReport,
}: SwarmCardProps) {
  const running = card.status === 'in_progress'
  /** A push-recorded completion (Faz 2.5), surfaced as the In review hint. */
  const completion = useCardCompletion(card.id)
  /** Parked with a kept worktree → Start resumes where the worker stopped. */
  const resumable = card.status === 'parked' && card.worktreePath !== null
  const identity = resolveIdentity(card, agent)
  const hasMeta = Boolean(
    card.agent || card.assignments.length > 0 || card.role || card.branch || card.councilSessionId,
  )

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    onDragStart(card)
  }

  /** Wrap an action so it never falls through to the card's open-editor click. */
  const act = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      className={`swarmCard ${STATUS_CLASS[card.status]} ${dragging ? 'swarmCard--dragging' : ''}`}
      style={{ '--i': index } as CSSProperties}
      data-swarm-card
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        // Only the card surface itself opens the editor — Enter on an action
        // button must stay that button's press.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(card.id)
        }
      }}
      aria-label={`Edit card: ${card.title}`}
    >
      <div className="swarmCard__head">
        <span
          className={`swarmCard__glyph swarmCard__glyph--${identity.tone}`}
          aria-hidden
        >
          {identity.monogram}
        </span>
        <span className="swarmCard__title">{card.title}</span>
        {statusGlyph(card.status)}
      </div>

      {card.body && <p className="swarmCard__preview">{card.body}</p>}

      {hasMeta && (
        <div className="swarmCard__tags">
          {card.agent ? (
            <span
              className={`swarmTag swarmTag--agent ${AGENT_TINTS[agent?.color ?? ''] ?? ''}`}
              title={agent ? (agent.tagline ?? agent.description) : `Unknown agent "${card.agent}"`}
            >
              {agent?.displayName ?? card.agent}
            </span>
          ) : card.assignments.length > 0 ? (
            <span className="swarmPipeline" role="list" aria-label="Agent pipeline">
              {card.assignments.map((a, i) => (
                <span key={`${a.role}-${a.spec ?? ''}-${i}`} className="swarmPipeline__step">
                  {i > 0 && <span className="swarmPipeline__arrow" aria-hidden>›</span>}
                  <span
                    role="listitem"
                    className={`swarmTag swarmTag--step${running && i === card.pipelineStep ? ' swarmTag--active' : ''}${!running && i < card.pipelineStep ? ' swarmTag--spent' : ''}`}
                  >
                    {assignmentLabel(a)}
                  </span>
                </span>
              ))}
            </span>
          ) : (
            card.role && <span className="swarmTag">{card.role}</span>
          )}
          {card.branch && (
            <span className="swarmTag swarmTag--branch" title={card.branch}>
              <IconBranch width={10} height={10} />
              <span className="swarmTag__text mono">{card.branch}</span>
            </span>
          )}
          {card.councilSessionId && (
            <span
              className="swarmTag swarmTag--council"
              title="Spec approved by the LLM council"
            >
              <IconCouncil width={10} height={10} /> council
            </span>
          )}
        </div>
      )}

      {card.worktreePath && (card.status === 'in_review' || card.status === 'parked') && (
        <ReviewStat projectId={card.projectId} dir={card.worktreePath} />
      )}

      {startable(card.status) && (
        <div className="swarmCard__foot">
          <button
            className="swarmStart"
            onClick={act(() => onStart(card.id))}
            disabled={starting}
            title={
              resumable
                ? 'Resume the agent in the same worktree it stopped in'
                : 'Put an agent on this card'
            }
          >
            {starting ? (
              <>
                <span className="swarmStart__pulse live-dot" aria-hidden />{' '}
                {resumable ? 'Resuming…' : 'Starting…'}
              </>
            ) : (
              <>
                <IconPlay width={10} height={10} /> {resumable ? 'Resume' : 'Start'}
              </>
            )}
          </button>
          {resumable && (
            <span
              className="swarmResumeHint"
              title="This card kept its git worktree — Resume continues where the worker stopped."
            >
              worktree kept
            </span>
          )}
        </div>
      )}

      {startable(card.status) && gated && (
        <div className="swarmGatePrompt" role="note">
          <p className="swarmGatePrompt__text">
            This card&rsquo;s spec hasn&rsquo;t passed the council yet. Convene the gate before a
            builder starts — or start anyway.
          </p>
          <div className="swarmGatePrompt__actions">
            <button
              className="btn btn--accent btn--sm"
              onClick={act(() => onConveneGate(card))}
              title="Gate this spec through the LLM council before a builder starts"
            >
              <IconCouncil width={11} height={11} aria-hidden /> Convene council
            </button>
            <button
              className="swarmCardLink"
              onClick={act(() => onStart(card.id, { skipGate: true }))}
              disabled={starting}
              title="Start the worker without a council-approved spec (recorded in the audit log)"
            >
              Start anyway
            </button>
          </div>
        </div>
      )}

      {running && <RunningActivity sessionId={card.terminalSessionId} />}

      {running && (
        <div className="swarmCard__foot">
          <button
            className="swarmCardLink"
            onClick={act(onViewTerminal)}
            title="Open the worker's terminal"
          >
            <IconTerminal width={11} height={11} /> View terminal
          </button>
          <button
            className="swarmCardLink"
            onClick={act(() => onPark(card.id))}
            disabled={parking}
            title="Stop the worker but keep its worktree — Resume later picks up there"
          >
            <IconPause width={11} height={11} /> {parking ? 'Parking…' : 'Park'}
          </button>
        </div>
      )}

      {card.status === 'in_review' && (
        <p className="swarmCard__hint">
          {completion ? (
            completion.summary
          ) : (
            <>
              Agent paused — review the diff below, or drag to <strong>Done</strong>.
            </>
          )}
        </p>
      )}

      {card.status === 'in_review' && (
        <div className="swarmCard__foot">
          <button
            className="swarmCardLink"
            onClick={act(() => onReport(card))}
            disabled={reviewing || counciling || reporting}
            title="Decision-ready summary — diff stat and acceptance criteria"
          >
            <IconCheck width={11} height={11} />
            {reporting ? 'Report…' : 'Report'}
          </button>
          <button
            className="swarmCardLink"
            onClick={act(() => onReview(card))}
            disabled={reviewing || counciling || reporting}
            title="AI review of the card's worktree diff"
          >
            <IconShieldSearch width={11} height={11} />
            {reviewing ? 'Reviewing…' : 'Review diff'}
          </button>
          <button
            className="swarmCardLink"
            onClick={act(() => onCouncil(card))}
            disabled={reviewing || counciling || reporting}
            title="LLM Council — five advisors debate the diff, then a chairman verdict"
          >
            <IconCouncil width={11} height={11} />
            {counciling ? 'Council…' : 'Council'}
          </button>
        </div>
      )}
    </div>
  )
}
