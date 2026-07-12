import { useEffect, useMemo, useRef } from 'react'
import type { CouncilProgressEvent, CouncilProgressStage } from '@shared/council'
import { IconCheck, IconCouncil, IconWarning } from './icons'

interface CouncilRoomProps {
  events: readonly CouncilProgressEvent[]
  responseLanguage?: string
}

const STAGES: { id: CouncilProgressStage; label: string; tr: string }[] = [
  { id: 'seats', label: 'Independent review', tr: 'Bağımsız inceleme' },
  { id: 'ranking', label: 'Peer review', tr: 'Karşılıklı değerlendirme' },
  { id: 'chairman', label: 'Chairman synthesis', tr: 'Chairman sentezi' },
]

function stagePosition(stage: CouncilProgressStage | undefined): number {
  if (stage === 'ranking') return 1
  if (stage === 'chairman') return 2
  if (stage === 'complete') return 3
  return 0
}

/** Honest waiting-room feed. It exposes only fixed stage telemetry and bounded
 * public seat output emitted by main; prompts, hidden reasoning, provider errors,
 * tool logs, and raw evidence never enter this component. */
export function CouncilRoom({ events, responseLanguage = 'en' }: CouncilRoomProps) {
  const turkish = responseLanguage.toLowerCase().startsWith('tr')
  const endRef = useRef<HTMLDivElement | null>(null)
  const feed = useMemo(() => events.slice(-8), [events])
  const latestStage = events.at(-1)?.stage
  const position = stagePosition(latestStage)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [feed.length])

  return (
    <section className="councilRoom" aria-label="Council live activity" aria-live="polite">
      <header className="councilRoom__head">
        <span className="councilRoom__mark" aria-hidden>
          <IconCouncil width={15} height={15} />
        </span>
        <div>
          <strong>Council room</strong>
          <span>
            {turkish
              ? 'Kısa çıktılar; gizli düşünce zinciri veya ham log değil'
              : 'Concise outputs, not private reasoning or raw logs'}
          </span>
        </div>
        <span className="councilRoom__live">live</span>
      </header>

      <ol className="councilRoom__stages" aria-label={turkish ? 'Council aşamaları' : 'Council stages'}>
        {STAGES.map((stage, index) => {
          const complete = position > index
          const active = position === index
          return (
            <li
              key={stage.id}
              className={`${complete ? 'councilRoom__stage--complete' : ''} ${active ? 'councilRoom__stage--active' : ''}`}
            >
              <span aria-hidden>{complete ? <IconCheck width={11} height={11} /> : index + 1}</span>
              {turkish ? stage.tr : stage.label}
            </li>
          )
        })}
      </ol>

      <div className="councilRoom__feed">
        {feed.length === 0 ? (
          <div className="councilRoom__message councilRoom__message--system">
            <span className="councilRoom__avatar" aria-hidden>
              <IconCouncil width={12} height={12} />
            </span>
            <div>
              <strong>System</strong>
              <p>{turkish ? 'Güvenli Council odası hazırlanıyor…' : 'Opening the secure Council room…'}</p>
            </div>
          </div>
        ) : (
          feed.map((event, index) => (
            <div
              key={`${event.at}-${event.stage}-${event.seatId ?? index}`}
              className={`councilRoom__message ${event.kind === 'seat' ? 'councilRoom__message--seat' : 'councilRoom__message--system'}`}
            >
              <span className="councilRoom__avatar" aria-hidden>
                {event.status === 'failed'
                  ? <IconWarning width={12} height={12} />
                  : event.status === 'completed'
                    ? <IconCheck width={12} height={12} />
                    : <IconCouncil width={12} height={12} />}
              </span>
              <div>
                <strong>{event.seatLabel ?? (turkish ? 'Council sistemi' : 'Council system')}</strong>
                <p>{event.message}</p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
      <footer className="councilRoom__foot">
        {turkish
          ? 'Bu sayfadan ayrılabilirsin; tamamlanan sonuç burada kalır.'
          : 'You can leave this page; the completed result will stay here.'}
      </footer>
    </section>
  )
}
