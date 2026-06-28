import { useEffect, useRef, useState } from 'react'
import type { RouteRecommendation } from '@shared/domain'
import type { ChatEngine } from '@shared/ipc'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { ApprovalCard } from './ApprovalCard'
import { IconBolt, IconChevron, IconSend, IconShield } from './icons'

interface Msg {
  id: number
  role: 'user' | 'assistant'
  text: string
  model?: string
  answering?: boolean
  error?: boolean
  route?: RouteRecommendation | null
}

const SUGGESTIONS = [
  'Bu projede sırada ne geliştirelim?',
  'API katmanını nasıl ekleriz?',
  'Show git diff for the nav',
  'Plan the next feature',
]

const ENGINES: { id: ChatEngine; label: string; sub: string }[] = [
  { id: 'claude', label: 'Claude', sub: 'Opus 4.8' },
  { id: 'codex', label: 'Codex', sub: 'OpenAI' },
]

const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  local: 'local command',
  chat: 'chat',
  railway: 'Railway',
}

export function RightPanel() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const dashboard = useStore((s) => s.dashboard)
  const approvals = useStore((s) => s.approvals)
  const setView = useStore((s) => s.setView)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const refreshApprovals = useStore((s) => s.refreshApprovals)
  const aiDraft = useStore((s) => s.aiDraft)
  const setAiDraft = useStore((s) => s.setAiDraft)
  const toggleChat = useStore((s) => s.toggleChat)

  const [engine, setEngine] = useState<ChatEngine>('claude')
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const pending = approvals.filter((a) => a.status === 'pending')

  useEffect(() => {
    if (aiDraft) {
      // A draft pushed from elsewhere should reveal the panel if it was collapsed.
      toggleChat(true)
      setInput(aiDraft)
      setAiDraft(null)
      taRef.current?.focus()
    }
  }, [aiDraft, setAiDraft, toggleChat])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs])

  const grow = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`
  }

  const submit = async (text: string) => {
    if (!text.trim() || !activeProjectId || busy) return
    const userId = Date.now()
    const aId = userId + 1
    setInput('')
    requestAnimationFrame(grow)
    setBusy(true)
    setMsgs((m) => [
      ...m,
      { id: userId, role: 'user', text },
      { id: aId, role: 'assistant', text: '', answering: true },
    ])
    try {
      const [result, reply] = await Promise.all([
        cockpit().router.route(activeProjectId, text),
        cockpit().chat.ask(activeProjectId, text, engine),
      ])
      setMsgs((m) =>
        m.map((x) =>
          x.id === aId
            ? { ...x, text: reply.text, model: reply.model, answering: false, error: !reply.ok, route: result.primary }
            : x,
        ),
      )
    } catch (e) {
      setMsgs((m) =>
        m.map((x) =>
          x.id === aId
            ? { ...x, text: e instanceof Error ? e.message : 'failed', answering: false, error: true }
            : x,
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  const act = async (rec: RouteRecommendation) => {
    if (!activeProjectId) return
    if (rec.requiresApproval) {
      await cockpit().approvals.request({
        projectId: activeProjectId,
        actionType: rec.agent === 'railway' ? 'redeploy' : 'shell_command',
        summary: `${rec.title}`,
        payload: { command: rec.suggestedCommand },
      })
      await refreshApprovals()
      return
    }
    if (rec.agent === 'claude' || rec.agent === 'codex') {
      await cockpit().terminals.launchAgent(activeProjectId, rec.agent)
      await refreshTerminals()
      setView('terminals')
    } else if (rec.agent === 'railway') {
      setView('railway')
    } else {
      setView('logs')
    }
  }

  const engineMeta = ENGINES.find((e) => e.id === engine) ?? ENGINES[0]

  return (
    <aside id="ai-cockpit-panel" className="right" aria-label="AI Cockpit">
      <div className="right__head">
        <div className="right__title">
          <IconBolt width={15} height={15} />
          <span>AI Cockpit</span>
        </div>
        <div className="right__headActions">
          <div className="engineSeg" role="tablist" aria-label="Model">
            {ENGINES.map((e) => (
              <button
                key={e.id}
                role="tab"
                aria-selected={engine === e.id}
                className={`engineSeg__opt ${engine === e.id ? 'is-active' : ''}`}
                onClick={() => setEngine(e.id)}
                title={`${e.label} · ${e.sub}`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="right__collapse"
            onClick={() => toggleChat(false)}
            aria-controls="ai-cockpit-panel"
            aria-expanded="true"
            aria-label="Collapse AI Cockpit"
            title="Collapse panel"
          >
            <IconChevron width={16} height={16} />
          </button>
        </div>
      </div>

      <div className="right__context">
        <div className="right__contextGrid">
          <div>
            <div className="right__ctxLabel">project</div>
            <div className="right__ctxValue">{dashboard?.project.name ?? '—'}</div>
          </div>
          <div>
            <div className="right__ctxLabel">model</div>
            <div className="right__ctxValue">{engineMeta.label} · {engineMeta.sub}</div>
          </div>
          <div>
            <div className="right__ctxLabel">branch</div>
            <div className="right__ctxValue mono">{dashboard?.branch ?? '—'}</div>
          </div>
          <div>
            <div className="right__ctxLabel">changes</div>
            <div className="right__ctxValue">{dashboard?.changedFiles ?? 0} files</div>
          </div>
        </div>
      </div>

      <div className="right__body chatlog scroll-y">
        {pending.length > 0 && (
          <section className="right__section">
            <div className="eyebrow right__sectionTitle">approval required · {pending.length}</div>
            {pending.map((a) => (
              <ApprovalCard key={a.id} request={a} />
            ))}
          </section>
        )}

        {msgs.length === 0 ? (
          <div className="right__empty">
            <p className="right__emptyLead">Ask the cockpit — {engineMeta.label} {engineMeta.sub}.</p>
            <p className="right__emptyHint">
              Answers are grounded in your project via your {engineMeta.label} CLI. Pick the model
              above; safe actions run, risky ones ask first.
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
          msgs.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg msg--user animate-in">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="msg msg--assistant animate-in">
                {m.answering ? (
                  <div className="msg__thinking">
                    <span className="msg__dots"><i /><i /><i /></span>
                    {engineMeta.label} düşünüyor…
                  </div>
                ) : (
                  <>
                    {m.model && m.model !== 'mock' && <div className="msg__model">{m.model}</div>}
                    <div className={`msg__text ${m.error ? 'is-error' : ''}`}>{m.text}</div>
                    {m.route && (
                      <button className="chat__routeChip" onClick={() => act(m.route as RouteRecommendation)}>
                        {m.route.requiresApproval && <IconShield width={11} height={11} />}
                        → {AGENT_LABEL[m.route.agent]}
                        <span className="chat__routeChipHint">
                          {m.route.requiresApproval ? 'needs approval' : 'run'}
                        </span>
                      </button>
                    )}
                  </>
                )}
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      <form
        className="right__compose"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(input)
        }}
      >
        <textarea
          ref={taRef}
          className="right__input right__input--area"
          placeholder={`Ask ${engineMeta.label}…  (Enter to send, Shift+Enter newline)`}
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value)
            grow()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit(input)
            }
          }}
          disabled={busy}
        />
        <button className="btn btn--accent right__send" type="submit" disabled={busy || !input.trim()}>
          <IconSend width={15} height={15} />
        </button>
      </form>
    </aside>
  )
}
