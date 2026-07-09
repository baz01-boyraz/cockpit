import { useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { CHAT_ENABLED } from '../lib/features'
import { useWindowedList } from '../hooks/useWindowedList'
import { IconBolt, IconSend, IconWarning, IconX } from '../components/icons'
import { classifyInsightRecency, RECENCY_HINT, type InsightRecency } from '@shared/insights'
import type { LogEvent } from '@shared/domain'
import { relativeTime } from '@shared/time'

const SEVERITY_CLASS: Record<string, string> = {
  low: 'chip--success',
  medium: 'chip--warning',
  high: 'chip--warning',
  critical: 'chip--danger',
}

const RECENCY_CLASS: Record<InsightRecency, string> = {
  active: 'chip--recency-active',
  recent: 'chip--recency-recent',
  earlier: 'chip--recency-earlier',
}

const RECENCY_TEXT: Record<InsightRecency, string> = {
  active: 'active',
  recent: 'recent',
  earlier: 'earlier',
}

const LEVEL_CLASS: Record<string, string> = {
  error: 'logline--error',
  warn: 'logline--warn',
  info: 'logline--info',
  debug: 'logline--debug',
}

/** "just now" / "4m ago" — concrete, honest last-seen labelling. */
function seenLabel(lastSeenAt: string): string {
  const t = relativeTime(lastSeenAt)
  return t === 'now' ? 'just now' : `${t} ago`
}

function LogLine({ log }: { log: LogEvent }) {
  return (
    <div className={`logline mono ${LEVEL_CLASS[log.level]}`}>
      <span className="logline__level">{log.level}</span>
      <span className="logline__src">{log.sourceType}</span>
      <span className="logline__msg">{log.message}</span>
    </div>
  )
}

export function LogsPanel() {
  const insights = useStore((s) => s.insights)
  const logs = useStore((s) => s.logs)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshInsights = useStore((s) => s.refreshInsights)
  const dismissInsight = useStore((s) => s.dismissInsight)
  const clearInsights = useStore((s) => s.clearInsights)
  const setAiDraft = useStore((s) => s.setAiDraft)
  const [probe, setProbe] = useState('')
  // Log rows are uniform height → fixed-height windowing. No-op under 200 rows.
  const stream = useWindowedList(logs.length, { rowHeight: 29 })

  const analyze = async () => {
    if (!probe.trim() || !activeProjectId) return
    await cockpit().logs.ingest({ projectId: activeProjectId, sourceType: 'system', message: probe })
    setProbe('')
    await refreshInsights()
  }

  const sendToAi = (title: string, action: string) => {
    setAiDraft(`Help me resolve this error: "${title}". Suggested action: ${action}`)
  }

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">observability</div>
          <h2 className="panel__title">Logs &amp; error intelligence</h2>
        </div>
        <div className="logs__probe">
          <input
            className="logs__probeInput mono"
            placeholder="Paste a log line to analyze…"
            value={probe}
            onChange={(e) => setProbe(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyze()}
          />
          <button className="btn btn--accent btn--sm" onClick={analyze} disabled={!probe.trim()}>
            <IconBolt width={13} height={13} /> Detect
          </button>
        </div>
      </div>

      <div className="logs__cols">
        <section className="card logs__insights">
          <div className="card__head">
            <div className="card__title">
              <IconWarning width={15} height={15} /> Detected insights
            </div>
            <div className="card__headActions">
              <span className="chip">{insights.length}</span>
              {insights.length > 0 && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => clearInsights()}
                  title="Dismiss all current insights. Any that happen again will resurface."
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
          {insights.length === 0 ? (
            <div className="emptyline">
              No active insights. Paste an error above or run a build — detected failures appear here
              with how recently they were seen.
            </div>
          ) : (
            <ul className="insightlist insightlist--full">
              {insights.map((e) => {
                const recency = classifyInsightRecency(e.lastSeenAt)
                return (
                  <li key={e.id} className="insight insight--card">
                    <button
                      className="insight__dismiss"
                      onClick={() => dismissInsight(e.matchedPattern)}
                      title="Dismiss. It will resurface if this error happens again."
                      aria-label={`Dismiss ${e.title}`}
                    >
                      <IconX width={13} height={13} />
                    </button>
                    <div className="insight__row">
                      <span className={`chip ${SEVERITY_CLASS[e.severity]}`}>{e.severity}</span>
                      <span className={`chip chip--recency ${RECENCY_CLASS[recency]}`} title={RECENCY_HINT[recency]}>
                        {recency === 'active' && <span className="recency__dot" aria-hidden />}
                        {RECENCY_TEXT[recency]}
                      </span>
                      <span className="insight__title">{e.title}</span>
                    </div>
                    <div className="insight__meta mono">
                      seen {seenLabel(e.lastSeenAt)}
                      {e.occurrences > 1 && <> · ×{e.occurrences}</>}
                    </div>
                    <div className="insight__cause">{e.likelyCause}</div>
                    <div className="insight__action">
                      <span className="eyebrow">fix</span> {e.suggestedAction}
                    </div>
                    <div className="insight__foot">
                      <span className="chip chip--accent">→ {e.suggestedAgent}</span>
                      {CHAT_ENABLED && (
                        <button className="btn btn--sm" onClick={() => sendToAi(e.title, e.suggestedAction)}>
                          <IconSend width={12} height={12} /> Send to AI
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="card logs__stream">
          <div className="card__head">
            <div className="card__title">Log stream</div>
            <span className="chip mono">{logs.length} events</span>
          </div>
          <div className="logstream scroll-y" ref={stream.scrollRef} onScroll={stream.onScroll}>
            {logs.length === 0 ? (
              <div className="emptyline">No log events captured yet.</div>
            ) : stream.windowed ? (
              <>
                <div className="logstream__pad" style={{ height: stream.padTop }} aria-hidden />
                {logs.slice(stream.start, stream.end).map((l) => (
                  <LogLine key={l.id} log={l} />
                ))}
                <div className="logstream__pad" style={{ height: stream.padBottom }} aria-hidden />
              </>
            ) : (
              logs.map((l) => <LogLine key={l.id} log={l} />)
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
