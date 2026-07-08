import type { ScorecardEntry } from '@shared/council'
import { COUNCIL_SEATS } from '@shared/council'
import { engineLabel } from '@shared/engines'
import { COUNCIL_TONE_CLASS } from './CouncilVerdict'

/** Seat id → its roster entry, so the standings read the seat's label + engine. */
const SEAT_BY_ID = new Map(COUNCIL_SEATS.map((s) => [s.id, s]))

/**
 * Cross-session seat standings (Faz 2b): each seat's mean rank across every
 * council it sat on, best (lowest average) first. A quiet companion to the
 * verdict — it answers "which lens has been carrying the room?" at a glance.
 * `entries === null` is the in-flight skeleton; `[]` is the pre-first-session
 * empty state; otherwise one row per seat with its engine chip, one-decimal
 * average rank, and how many sessions it has spoken in.
 */
export function CouncilScorecard({ entries }: { entries: ScorecardEntry[] | null }) {
  return (
    <section className="councilScore" aria-label="Council seat standings">
      <div className="eyebrow">seat standings</div>

      {entries === null ? (
        <div className="councilScore__skeleton" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="councilScore__ghost" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="councilScore__empty">The council has not convened yet.</p>
      ) : (
        <ol className="councilScore__list">
          {entries.map((entry, i) => {
            const seat = SEAT_BY_ID.get(entry.seatId)
            return (
              <li
                key={entry.seatId}
                className={`councilScore__row ${COUNCIL_TONE_CLASS[entry.seatId] ?? ''}`}
              >
                <span className="councilScore__pos mono">{i + 1}</span>
                <span className="councilScore__seat">{seat?.label ?? entry.seatId}</span>
                {seat && <span className="councilScore__engine">{engineLabel(seat.engine)}</span>}
                <span
                  className="councilScore__avg mono"
                  title="Average rank across sessions (lower is better)"
                >
                  {entry.averageRank.toFixed(1)}
                </span>
                <span
                  className="councilScore__sessions mono"
                  title={`${entry.sessions} session${entry.sessions === 1 ? '' : 's'}`}
                >
                  {entry.sessions}×
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
