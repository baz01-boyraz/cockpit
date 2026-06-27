import { useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconBolt, IconSend, IconWarning } from '../components/icons'

const SEVERITY_CLASS: Record<string, string> = {
  low: 'chip--success',
  medium: 'chip--warning',
  high: 'chip--warning',
  critical: 'chip--danger',
}

const LEVEL_CLASS: Record<string, string> = {
  error: 'logline--error',
  warn: 'logline--warn',
  info: 'logline--info',
  debug: 'logline--debug',
}

export function LogsPanel() {
  const insights = useStore((s) => s.insights)
  const logs = useStore((s) => s.logs)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshInsights = useStore((s) => s.refreshInsights)
  const setAiDraft = useStore((s) => s.setAiDraft)
  const [probe, setProbe] = useState('')

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
    <div className="panel">
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
            <span className="chip">{insights.length}</span>
          </div>
          {insights.length === 0 ? (
            <div className="emptyline">No insights yet. Paste an error above or run a build.</div>
          ) : (
            <ul className="insightlist insightlist--full">
              {insights.map((e) => (
                <li key={e.id} className="insight insight--card">
                  <div className="insight__row">
                    <span className={`chip ${SEVERITY_CLASS[e.severity]}`}>{e.severity}</span>
                    <span className="insight__title">{e.title}</span>
                  </div>
                  <div className="insight__cause">{e.likelyCause}</div>
                  <div className="insight__action">
                    <span className="eyebrow">fix</span> {e.suggestedAction}
                  </div>
                  <div className="insight__foot">
                    <span className="chip chip--accent">→ {e.suggestedAgent}</span>
                    <button className="btn btn--sm" onClick={() => sendToAi(e.title, e.suggestedAction)}>
                      <IconSend width={12} height={12} /> Send to AI
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card logs__stream">
          <div className="card__head">
            <div className="card__title">Log stream</div>
            <span className="chip mono">{logs.length} events</span>
          </div>
          <div className="logstream scroll-y">
            {logs.length === 0 ? (
              <div className="emptyline">No log events captured yet.</div>
            ) : (
              logs.map((l) => (
                <div key={l.id} className={`logline mono ${LEVEL_CLASS[l.level]}`}>
                  <span className="logline__level">{l.level}</span>
                  <span className="logline__src">{l.sourceType}</span>
                  <span className="logline__msg">{l.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
