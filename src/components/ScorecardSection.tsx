import { useEffect, useState } from 'react'
import type { OutcomeScorecard } from '@shared/outcomes'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'

/**
 * The read-only judgment scorecard (Track G4) — a small section in the Usage
 * panel answering "how well are the machines judging?" beside "how is the quota
 * spent?". It shows a handful of derived numbers (spec-gate leverage, gate
 * calibration, card fate mix, memory earned-keep, top notes, triage precision,
 * best council seat) with honest empty states, and NO knobs: these numbers
 * change nothing, they are a dashboard, not a control.
 *
 * Honesty ceiling: every figure is a *correlation* (gated cards ship more), never
 * a proof. The copy states this plainly and never claims causation.
 */

/** Render a 0..1 fraction as a whole percent, or an em dash for a null floor. */
function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

/** A signed percentage-point delta (e.g. "+25 pts"), or an em dash when null. */
function ptsDelta(value: number | null): string {
  if (value === null) return '—'
  const pts = Math.round(value * 100)
  return `${pts >= 0 ? '+' : ''}${pts} pts`
}

interface MetricProps {
  label: string
  value: string
  sub: string
  /** When true, the tile reads as an honest "not enough data yet" empty state. */
  empty?: boolean
  tone?: 'accent' | 'signal' | 'neutral'
}

function Metric({ label, value, sub, empty = false, tone = 'neutral' }: MetricProps) {
  return (
    <div className={`scoreMetric scoreMetric--${tone} ${empty ? 'scoreMetric--empty' : ''}`}>
      <div className="scoreMetric__label">{label}</div>
      <div className="scoreMetric__value mono">{empty ? 'No data yet' : value}</div>
      <div className="scoreMetric__sub">{empty ? 'not enough history to judge' : sub}</div>
    </div>
  )
}

const SEAT_LABELS: Record<string, string> = {
  contrarian: 'Contrarian',
  'first-principles': 'First Principles',
  expansionist: 'Expansionist',
  outsider: 'Outsider',
  builder: 'Builder',
}

function ScorecardBody({ card }: { card: OutcomeScorecard }) {
  const { cards, triage, memory, bestSeat } = card
  const hasCards = cards.total > 0
  const seatName = bestSeat ? (SEAT_LABELS[bestSeat.seatId] ?? bestSeat.seatId) : null

  return (
    <div className="scorecard__grid">
      <Metric
        label="Spec-gate leverage"
        value={ptsDelta(cards.shipRate.delta)}
        sub={`gated ${pct(cards.shipRate.gated)} vs ungated ${pct(cards.shipRate.ungated)} shipped`}
        empty={cards.shipRate.delta === null}
        tone="accent"
      />
      <Metric
        label="Gate calibration"
        value={`${pct(cards.gateCalibration.approvedShipRate)} / ${pct(cards.gateCalibration.needsClarificationShipRate)}`}
        sub="approved vs needs-clarification, % shipped"
        empty={
          cards.gateCalibration.approvedShipRate === null &&
          cards.gateCalibration.needsClarificationShipRate === null
        }
      />
      <Metric
        label="Card fate mix"
        value={`${cards.fateMix.shipped} / ${cards.fateMix.reworked} / ${cards.fateMix.abandoned}`}
        sub="shipped / reworked / abandoned"
        empty={!hasCards}
      />
      <Metric
        label="Triage precision"
        value={pct(triage.precision)}
        sub={`${triage.resolved} answered · ${triage.misses} miss${triage.misses === 1 ? '' : 'es'}`}
        empty={triage.precision === null}
        tone="signal"
      />
      <Metric
        label="Memory earned-keep"
        value={pct(memory.earnedKeepRate)}
        sub={`${memory.recalledNotes}/${memory.totalNotes} notes recalled · ${memory.neverRecalled} never`}
        empty={memory.totalNotes === 0}
      />
      <Metric
        label="Best council seat"
        value={seatName ?? '—'}
        sub={bestSeat ? `avg rank ${bestSeat.averageRank.toFixed(1)} · ${bestSeat.sessions} sessions` : ''}
        empty={!bestSeat}
      />

      {memory.topRecalled.length > 0 ? (
        <div className="scoreMetric scoreMetric--wide scoreMetric--neutral">
          <div className="scoreMetric__label">Most-recalled notes · last {card.memoryWindowDays}d</div>
          <ul className="scoreTop">
            {memory.topRecalled.map((n) => (
              <li key={n.note} className="scoreTop__item">
                <span className="scoreTop__name mono">{n.note}</span>
                <span className="scoreTop__count">{n.count}×</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function ScorecardSection() {
  const projectId = useStore((s) => s.activeProjectId)
  const [card, setCard] = useState<OutcomeScorecard | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setCard(null)
      return
    }
    let live = true
    setCard(null)
    setFailed(false)
    void (async () => {
      try {
        const result = await cockpit().outcomes.scorecard(projectId)
        // A project switch mid-fetch must never flash another project's numbers.
        if (live && useStore.getState().activeProjectId === projectId) setCard(result)
      } catch {
        if (live && useStore.getState().activeProjectId === projectId) setFailed(true)
      }
    })()
    return () => {
      live = false
    }
  }, [projectId])

  return (
    <div className="card scorecard">
      <div className="card__head">
        <div className="card__title">Judgment scorecard</div>
        <span className="chip">read-only · last {card?.cardWindowDays ?? 30}d</span>
      </div>
      <p className="scorecard__note">
        How the cockpit&apos;s judgment systems are doing — the spec gate, triage, memory recall, and
        the council. These are correlations, not proof: a signal here is a prompt to look, never a
        verdict.
      </p>
      {failed ? (
        <div className="scorecard__empty">Couldn&apos;t read the scorecard right now.</div>
      ) : card === null ? (
        <div className="scorecard__skeleton" aria-hidden />
      ) : (
        <ScorecardBody card={card} />
      )}
    </div>
  )
}
