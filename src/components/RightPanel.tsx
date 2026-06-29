import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { RouteRecommendation } from '@shared/domain'
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, type ChatModel } from '@shared/chat-models'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  firstImage,
  firstImageFromItems,
  formatBytes,
  hasFileDrag,
  inferImageMime,
  readBase64,
} from '../lib/imageAttach'
import { ApprovalCard } from './ApprovalCard'
import { IconBolt, IconChevron, IconCopy, IconImage, IconSend, IconShield, IconX } from './icons'

interface ChatImage {
  previewUrl: string
  name: string
}

interface Msg {
  id: number
  role: 'user' | 'assistant'
  text: string
  model?: string
  answering?: boolean
  error?: boolean
  route?: RouteRecommendation | null
  image?: ChatImage
}

interface PendingAttachment {
  relativePath: string
  name: string
  size: number
  previewUrl: string
}

const SUGGESTIONS = [
  'Bu projede sırada ne geliştirelim?',
  'API katmanını nasıl ekleriz?',
  'Show git diff for the nav',
  'Plan the next feature',
]

/** The chat brand shown alongside the picked Claude model. */
const CHAT_BRAND = 'Claude'

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

  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [busy, setBusy] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [model, setModel] = useState<ChatModel>(DEFAULT_CHAT_MODEL)
  const [pickerOpen, setPickerOpen] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const objectUrlsRef = useRef<string[]>([])

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

  // Revoke every object URL we created (previews) when the panel unmounts.
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      objectUrlsRef.current = []
    }
  }, [])

  const grow = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(160, ta.scrollHeight)}px`
  }

  const trackUrl = (url: string) => {
    objectUrlsRef.current = [...objectUrlsRef.current, url]
    return url
  }

  const saveImage = async (file: File) => {
    if (!activeProjectId) {
      setAttachError('Select a project first.')
      return
    }
    const mimeType = inferImageMime(file)
    if (!mimeType) {
      setAttachError('Use PNG, JPG, WebP, or GIF.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachError('Image must be 10 MB or smaller.')
      return
    }

    const previewUrl = trackUrl(URL.createObjectURL(file))
    setAttaching(true)
    setAttachError(null)
    try {
      const dataBase64 = await readBase64(file)
      const saved = await cockpit().terminals.attachImage({
        projectId: activeProjectId,
        sessionId: null,
        fileName: file.name,
        mimeType,
        dataBase64,
      })
      setAttachment({ relativePath: saved.relativePath, name: saved.name, size: saved.size, previewUrl })
    } catch (err) {
      URL.revokeObjectURL(previewUrl)
      objectUrlsRef.current = objectUrlsRef.current.filter((u) => u !== previewUrl)
      setAttachError(err instanceof Error ? err.message : 'Could not attach image.')
    } finally {
      setAttaching(false)
    }
  }

  const clearAttachment = () => {
    setAttachment(null)
    setAttachError(null)
  }

  const submit = async (text: string) => {
    const trimmed = text.trim()
    const att = attachment
    if ((!trimmed && !att) || !activeProjectId || busy) return

    const userId = Date.now()
    const aId = userId + 1
    setInput('')
    setAttachment(null)
    setAttachError(null)
    requestAnimationFrame(grow)
    setBusy(true)

    const routerQuery = trimmed || 'Review the attached image.'
    const chatPrompt = att
      ? `${trimmed || 'Please review the attached image.'}\n\n[Attached image saved in this project at: ${att.relativePath}]`
      : trimmed

    setMsgs((m) => [
      ...m,
      {
        id: userId,
        role: 'user',
        text: trimmed,
        image: att ? { previewUrl: att.previewUrl, name: att.name } : undefined,
      },
      { id: aId, role: 'assistant', text: '', answering: true },
    ])
    try {
      const [result, reply] = await Promise.all([
        cockpit().router.route(activeProjectId, routerQuery),
        cockpit().chat.ask(activeProjectId, chatPrompt, { model: model.id }),
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

  const copy = async (m: Msg) => {
    if (!m.text) return
    try {
      await navigator.clipboard.writeText(m.text)
      setCopiedId(m.id)
      window.setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1500)
    } catch {
      /* clipboard unavailable — nothing to surface */
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

  const resetDrag = () => {
    dragDepthRef.current = 0
    setDragging(false)
  }

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    resetDrag()
    const file = firstImage(event.dataTransfer.files)
    if (file) void saveImage(file)
    else setAttachError('Drop a PNG, JPG, WebP, or GIF image.')
  }

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const file = firstImage(event.clipboardData.files) ?? firstImageFromItems(event.clipboardData.items)
    if (!file) return
    event.preventDefault()
    void saveImage(file)
  }

  const canSend = !busy && (Boolean(input.trim()) || Boolean(attachment))

  return (
    <aside
      id="ai-cockpit-panel"
      className={`right ${dragging ? 'right--dragging' : ''}`}
      aria-label="AI Cockpit"
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      <div className="right__head">
        <div className="right__title">
          <IconBolt width={15} height={15} />
          <span>AI Cockpit</span>
        </div>
        <div className="right__headActions">
          <div className="engineSeg engineSeg--menu" aria-label="Chat model">
            <button
              type="button"
              className="engineSeg__opt is-active"
              title={`${CHAT_BRAND} · ${model.name}`}
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
            >
              {model.label}
              <IconChevron width={12} height={12} className="engineSeg__caret" />
            </button>
            {pickerOpen && (
              <>
                <div className="engineMenu__backdrop" onClick={() => setPickerOpen(false)} />
                <div className="engineMenu" role="menu">
                  <div className="engineMenu__eyebrow">chat model</div>
                  {CHAT_MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={model.id === m.id}
                      className={`engineMenu__item ${model.id === m.id ? 'is-active' : ''}`}
                      onClick={() => {
                        setModel(m)
                        setPickerOpen(false)
                      }}
                    >
                      <span>{m.name}</span>
                      <span className="engineMenu__hint">{m.hint}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
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
            <div className="right__ctxValue">{CHAT_BRAND} · {model.label}</div>
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
            <p className="right__emptyLead">Ask the cockpit — {model.name}.</p>
            <p className="right__emptyHint">
              Answers come from Claude, grounded in this project. Safe to read, risky actions stay
              out of reach. Drag an image in to attach it.
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
                <div className="msg__marker" aria-hidden>
                  <span className="msg__markerDot" />
                  <span>You</span>
                </div>
                {m.image && <img className="msg__image" src={m.image.previewUrl} alt={m.image.name} />}
                {m.text && <div className="msg__userText">{m.text}</div>}
              </div>
            ) : (
              <div key={m.id} className="msg msg--assistant animate-in">
                {m.answering ? (
                  <div className="msg__thinking">
                    <span className="msg__dots"><i /><i /><i /></span>
                    {CHAT_BRAND} düşünüyor…
                  </div>
                ) : (
                  <>
                    <div className="msg__topbar">
                      {m.model && m.model !== 'mock' ? (
                        <div className="msg__model">{m.model}</div>
                      ) : (
                        <span />
                      )}
                      {m.text && !m.error && (
                        <button
                          type="button"
                          className={`msg__copy ${copiedId === m.id ? 'is-copied' : ''}`}
                          onClick={() => void copy(m)}
                          title="Copy message"
                          aria-label="Copy message"
                        >
                          <IconCopy width={13} height={13} />
                          <span>{copiedId === m.id ? 'Copied' : 'Copy'}</span>
                        </button>
                      )}
                    </div>
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

      {dragging && (
        <div className="right__drop">
          <div className="right__dropIcon">
            <IconImage width={22} height={22} />
          </div>
          <div>
            <div className="right__dropTitle">Drop to attach image</div>
            <div className="right__dropSub">Saved into this project, then sent with your next message.</div>
          </div>
        </div>
      )}

      {(attachment || attaching || attachError) && (
        <div className="right__attach">
          {attachment ? (
            <>
              <img className="right__attachThumb" src={attachment.previewUrl} alt="" />
              <div className="right__attachBody">
                <div className="right__attachName">{attachment.name}</div>
                <div className="right__attachMeta">{formatBytes(attachment.size)} · ready to send</div>
              </div>
              <button className="iconbtn" title="Remove attachment" onClick={clearAttachment}>
                <IconX width={13} height={13} />
              </button>
            </>
          ) : (
            <>
              {attaching ? <div className="right__attachLoader" /> : <IconImage width={16} height={16} />}
              <div className="right__attachBody">
                <div className="right__attachName">{attaching ? 'Attaching image…' : 'Image not attached'}</div>
                {attachError && <div className="right__attachMeta is-error">{attachError}</div>}
              </div>
              {attachError && (
                <button className="iconbtn" title="Dismiss" onClick={() => setAttachError(null)}>
                  <IconX width={13} height={13} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      <form
        className="right__compose"
        onSubmit={(e) => {
          e.preventDefault()
          void submit(input)
        }}
      >
        <input
          ref={fileInputRef}
          className="right__file"
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0]
            e.currentTarget.value = ''
            if (file) void saveImage(file)
          }}
        />
        <button
          type="button"
          className="right__attachBtn"
          title="Attach image"
          aria-label="Attach image"
          disabled={busy || attaching}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconImage width={15} height={15} />
        </button>
        <textarea
          ref={taRef}
          className="right__input right__input--area"
          placeholder={`Ask ${CHAT_BRAND}…  (Enter to send, Shift+Enter newline)`}
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
          onPaste={handlePaste}
          disabled={busy}
        />
        <button className="btn btn--accent right__send" type="submit" disabled={!canSend}>
          <IconSend width={15} height={15} />
        </button>
      </form>
    </aside>
  )
}
