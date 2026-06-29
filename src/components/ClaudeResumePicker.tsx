import { useEffect, useState } from 'react'
import type { ClaudeSessionSummary, TerminalSession } from '@shared/domain'
import { relativeTime } from '@shared/time'
import { cockpit } from '../lib/cockpit'
import { IconBolt, IconRestart, IconX } from './icons'

interface ClaudeResumePickerProps {
  projectId: string
  onResumed: (session: TerminalSession) => void
  onClose: () => void
}

function lastActiveLabel(iso: string): string {
  const t = relativeTime(iso)
  return t === 'now' ? 'just now' : `${t} ago`
}

/**
 * Lists this project's past Claude Code conversations (read from the agent's own
 * transcripts) and opens a new terminal that resumes the chosen one — so the
 * session starts with full memory instead of cold.
 */
export function ClaudeResumePicker({ projectId, onResumed, onClose }: ClaudeResumePickerProps) {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    cockpit()
      .terminals.claudeSessions(projectId)
      .then((s) => alive && setSessions(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load sessions'))
    return () => {
      alive = false
    }
  }, [projectId])

  const resume = async (s: ClaudeSessionSummary) => {
    if (busy) return
    setBusy(s.id)
    try {
      const term = await cockpit().terminals.resumeClaude(projectId, s.id)
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
            <div className="eyebrow">claude code</div>
            <h2 className="modal__title">Resume a session</h2>
          </div>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>
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
              No past Claude conversations for this project yet. Launch Claude to start one.
            </div>
          )}
          {sessions?.map((s) => (
            <button
              key={s.id}
              className="resumecard"
              onClick={() => void resume(s)}
              disabled={busy !== null}
              title={s.title}
            >
              <span className="resumecard__icon">
                <IconBolt width={15} height={15} />
              </span>
              <div className="resumecard__body">
                <div className="resumecard__title">{s.title}</div>
                <div className="resumecard__meta mono">
                  {lastActiveLabel(s.lastActiveAt)} · {s.id.slice(0, 8)}
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
