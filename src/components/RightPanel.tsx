import { useEffect, useState } from 'react'
import type { RouteRecommendation, RouterResult } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { RouteCard } from './RouteCard'
import { ApprovalCard } from './ApprovalCard'
import { IconBolt, IconSend } from './icons'

interface ChatTurn {
  id: number
  query: string
  result: RouterResult | null
  answer: string | null
  model: string | null
  answering: boolean
  error: boolean
}

const SUGGESTIONS = [
  'Bu projede neyi geliştirelim?',
  'API katmanını nasıl ekleriz?',
  'Show git diff for the nav',
  'Plan the next feature',
]

export function RightPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const dashboard = useStore((s) => s.dashboard)
  const approvals = useStore((s) => s.approvals)
  const setView = useStore((s) => s.setView)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const refreshApprovals = useStore((s) => s.refreshApprovals)

  const aiDraft = useStore((s) => s.aiDraft)
  const setAiDraft = useStore((s) => s.setAiDraft)

  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [busy, setBusy] = useState(false)

  // Consume a draft handed over from another panel (e.g. "Send to AI").
  useEffect(() => {
    if (aiDraft) {
      setInput(aiDraft)
      setAiDraft(null)
    }
  }, [aiDraft, setAiDraft])

  const pending = approvals.filter((a) => a.status === 'pending')

  const submit = async (text: string) => {
    if (!text.trim() || !activeProjectId) return
    const id = Date.now()
    setInput('')
    setBusy(true)
    setTurns((t) => [
      { id, query: text, result: null, answer: null, model: null, answering: true, error: false },
      ...t,
    ])
    try {
      // Classify the route (instant) and ask the real model (Claude Code) in parallel.
      const [result, reply] = await Promise.all([
        cockpit().router.route(activeProjectId, text),
        cockpit().chat.ask(activeProjectId, text),
      ])
      setTurns((t) =>
        t.map((x) =>
          x.id === id
            ? { ...x, result, answer: reply.text, model: reply.model, answering: false, error: !reply.ok }
            : x,
        ),
      )
    } catch (e) {
      setTurns((t) =>
        t.map((x) =>
          x.id === id
            ? { ...x, answering: false, error: true, answer: e instanceof Error ? e.message : 'failed' }
            : x,
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const act = async (rec: RouteRecommendation, query: string) => {
    if (!activeProjectId) return
    if (rec.requiresApproval) {
      await cockpit().approvals.request({
        projectId: activeProjectId,
        actionType: rec.agent === 'railway' ? 'redeploy' : 'shell_command',
        summary: `${rec.title}: ${query}`,
        payload: { query, command: rec.suggestedCommand },
      })
      await refreshApprovals()
      return
    }
    if (rec.agent === 'claude' || rec.agent === 'codex') {
      await cockpit().terminals.launchAgent(activeProjectId, rec.agent)
      await refreshTerminals()
      setView('terminals')
    } else {
      setView(rec.agent === 'railway' ? 'railway' : 'logs')
    }
  }

  return (
    <aside className="right">
      <div className="right__head">
        <div className="right__title">
          <IconBolt width={15} height={15} />
          <span>AI Cockpit</span>
        </div>
        <span className="chip chip--accent" title="Chat answers come from your Claude Code CLI">
          <span className="chip__dot live-dot" />
          Opus 4.8
        </span>
      </div>

      <div className="right__context">
        <div className="right__contextRow">
          <span className="eyebrow">context</span>
        </div>
        <div className="right__contextGrid">
          <div>
            <div className="right__ctxLabel">project</div>
            <div className="right__ctxValue">{dashboard?.project.name ?? '—'}</div>
          </div>
          <div>
            <div className="right__ctxLabel">branch</div>
            <div className="right__ctxValue mono">{dashboard?.branch ?? '—'}</div>
          </div>
          <div>
            <div className="right__ctxLabel">changes</div>
            <div className="right__ctxValue">{dashboard?.changedFiles ?? 0} files</div>
          </div>
          <div>
            <div className="right__ctxLabel">stack</div>
            <div className="right__ctxValue">{dashboard?.project.techStack.slice(0, 2).join(', ') || '—'}</div>
          </div>
        </div>
      </div>

      <div className="right__body scroll-y">
        {pending.length > 0 && (
          <section className="right__section">
            <div className="eyebrow right__sectionTitle">approval required · {pending.length}</div>
            {pending.map((a) => (
              <ApprovalCard key={a.id} request={a} />
            ))}
          </section>
        )}

        {turns.length === 0 ? (
          <div className="right__empty">
            <p className="right__emptyLead">Ask the cockpit — answered by Claude Opus 4.8.</p>
            <p className="right__emptyHint">
              It answers from your project with your Claude Code CLI, and suggests which agent to route
              the task to. Safe actions run; risky ones ask first.
            </p>
            <div className="right__suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="right__chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn) => (
            <section key={turn.id} className="right__turn animate-in">
              <div className="right__query">{turn.query}</div>

              {turn.answering ? (
                <div className="right__answer right__answer--thinking">
                  <span className="chip chip--accent">
                    <span className="chip__dot live-dot" />
                    Claude Opus 4.8 düşünüyor…
                  </span>
                </div>
              ) : turn.answer ? (
                <div className={`right__answer ${turn.error ? 'right__answer--error' : ''}`}>
                  {turn.model && turn.model !== 'mock' && (
                    <div className="right__answerModel">{turn.model}</div>
                  )}
                  <div className="right__answerText">{turn.answer}</div>
                </div>
              ) : null}

              {turn.result && (
                <>
                  <div className="eyebrow right__routeHint">suggested route</div>
                  <RouteCard rec={turn.result.primary} primary onAct={(r) => act(r, turn.query)} />
                </>
              )}
            </section>
          ))
        )}
      </div>

      <form
        className="right__compose"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(input)
        }}
      >
        <input
          className="right__input"
          placeholder="Describe a task…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn--accent right__send" type="submit" disabled={busy || !input.trim()}>
          <IconSend width={15} height={15} />
        </button>
      </form>
    </aside>
  )
}
