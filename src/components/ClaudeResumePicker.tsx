import { useEffect, useState } from 'react'
import type { ResumableSessionSummary, TerminalSession } from '@shared/domain'
import { compactDateTime } from '@shared/time'
import { cockpit } from '../lib/cockpit'
import { IconBolt, IconRestart, IconTerminal, IconX } from './icons'

interface AgentResumePickerProps {
  projectId: string
  onResumed: (session: TerminalSession) => void
  onClose: () => void
}

/**
 * Lists this project's Claude and Codex conversations together and resumes the
 * selected one through its native CLI.
 */
export function AgentResumePicker({ projectId, onResumed, onClose }: AgentResumePickerProps) {
  const [sessions, setSessions] = useState<ResumableSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    cockpit()
      .terminals.agentSessions(projectId)
      .then((s) => alive && setSessions(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load sessions'))
    return () => {
      alive = false
    }
  }, [projectId])

  const resume = async (s: ResumableSessionSummary) => {
    if (busy) return
    setBusy(s.id)
    try {
      const term = await cockpit().terminals.resumeAgent(projectId, s.provider, s.id)
      onResumed(term)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resume session')
      setBusy(null)
    }
  }

  return (
    <div className="modal" onMouseDown={onClose}>
      <div className="modal__panel animate-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <div className="eyebrow">claude + codex</div>
            <h2 className="modal__title">Resume a session</h2>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            aria-label="Close resume sessions"
            onClick={onClose}
          >
            <IconX width={15} height={15} />
          </button>
        </div>

        <div className="modal__list">
          {sessions === null && !error && (
            <div className="modal__emptyState">Loading conversations…</div>
          )}
          {error && <div className="modal__error">{error}</div>}
          {sessions && sessions.length === 0 && !error && (
            <div className="modal__emptyState">
              No past Claude or Codex conversations for this project yet.
            </div>
          )}
          {sessions?.map((s) => (
            <button
              key={`${s.provider}:${s.id}`}
              className="resumecard"
              onClick={() => void resume(s)}
              disabled={busy !== null}
              title={s.title}
            >
              <span className="resumecard__icon">
                {s.provider === 'claude' ? (
                  <IconBolt width={15} height={15} />
                ) : (
                  <IconTerminal width={15} height={15} />
                )}
              </span>
              <div className="resumecard__body">
                <div className="resumecard__title">{s.title}</div>
                <div className="resumecard__meta">
                  <span className={`resumecard__provider resumecard__provider--${s.provider}`}>
                    {s.provider === 'claude' ? 'Claude' : 'Codex'}
                  </span>
                  <span className="resumecard__datetime mono">
                    {compactDateTime(s.lastActiveAt)}
                  </span>
                  <span className="resumecard__id mono">{s.id.slice(0, 8)}</span>
                </div>
              </div>
              <span className="resumecard__action">
                <IconRestart width={14} height={14} />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
