/**
 * Hermes — a docked chat panel, triggered from the rail's Engines row
 * (`UsageStrip.tsx`), not a launcher bubble of its own. Docked, not floating,
 * on purpose: an earlier floating version sat on top of the terminal grid and
 * covered whatever pane happened to be under it. This renders as a real grid
 * column in `.shell` (see `AppShell.tsx` / `.shell--hermes-open` in
 * components.css) that widens from 0 when open, so opening Hermes shrinks the
 * terminal grid instead of covering it — the same technique `RightPanel.tsx`
 * uses for the AI Cockpit chat. `hermesOpen` / `toggleHermes` live in the
 * store so the rail button, this panel, and the shell's grid class all agree
 * on open state despite sitting in unrelated parts of the tree.
 *
 * Wired to the real backend (`window.cockpit.hermesChat`): each send is a full
 * agentic turn that can take a while, so the composer locks and a "thinking"
 * indicator shows until the reply resolves. `ok: false` replies are surfaced as
 * a distinct, muted error message in the thread — never a crash or blank screen.
 *
 * Images attach the same way the AI Cockpit chat does (`RightPanel.tsx`): saved
 * into the project's `.dev-cockpit/attachments/` via `terminals.attachImage`,
 * then the saved absolute path is passed to `hermesChat.ask`, which forwards it
 * to `hermes chat --image` (the only Hermes CLI mode that accepts one).
 *
 * Self-contained on purpose (own glyphs + `hermes.css`) so the feature touches no
 * shared UI file. Built on the Obsidian-Ember tokens; animates only transform/opacity.
 */
import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent, SVGProps } from 'react'
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
import { renderHermesText } from '../lib/hermesMarkup'
import hermesAvatar from '../assets/hermes/avatar.png'

type IconProps = SVGProps<SVGSVGElement>

type HermesRole = 'user' | 'hermes' | 'error'

interface HermesImage {
  previewUrl: string
  name: string
}

interface HermesMessage {
  id: string
  role: HermesRole
  text: string
  image?: HermesImage
}

interface PendingAttachment {
  path: string
  name: string
  size: number
  previewUrl: string
}

const base = (props: IconProps): IconProps => ({
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  ...props,
})

const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

const IconSend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 12 20 5l-4.2 14.5-3.9-6.1L4.5 12Z" />
    <path d="m11.9 13.4 3.9-6.4" />
  </svg>
)

/** New-conversation glyph — a fresh page with a spark. */
const IconNewChat = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H12" />
    <path d="M20 12.5v6A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5V9" />
    <path d="M17.5 3.5 20.5 6.5 14 13l-3.2.7.7-3.2 6-7Z" />
  </svg>
)

/** Attach-image glyph — a mountain photo frame. */
const IconImage = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="M4.5 16.5 9.5 12l3 2.8 3-3.3 4 4" />
  </svg>
)

const IconX = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

let msgSeq = 0
const nextId = (): string => `hm-${Date.now().toString(36)}-${(msgSeq++).toString(36)}`

export function HermesWidget() {
  const open = useStore((s) => s.hermesOpen)
  const toggleHermes = useStore((s) => s.toggleHermes)
  const [messages, setMessages] = useState<HermesMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<PendingAttachment | null>(null)
  const [attaching, setAttaching] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const panelRef = useRef<HTMLElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const objectUrlsRef = useRef<string[]>([])

  const noProject = !activeProjectId
  const hasMessages = messages.length > 0

  // Esc closes the panel while it's open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleHermes(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, toggleHermes])

  // Keep the thread pinned to the newest message / the thinking indicator.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  // Revoke every object URL we created (previews) when the widget unmounts.
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
      objectUrlsRef.current = []
    }
  }, [])

  const grow = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(180, ta.scrollHeight)}px`
  }

  const trackUrl = (url: string) => {
    objectUrlsRef.current = [...objectUrlsRef.current, url]
    return url
  }

  const saveImage = async (file: File) => {
    if (!activeProjectId) {
      setAttachError('Open a project first.')
      return
    }
    const mimeType = inferImageMime(file)
    if (!mimeType) {
      setAttachError('Use PNG, JPG, WebP, or GIF.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachError(`Image must be ${formatBytes(MAX_IMAGE_BYTES)} or smaller.`)
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
      setAttachment({ path: saved.path, name: saved.name, size: saved.size, previewUrl })
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

  const send = async () => {
    const text = input.trim()
    const att = attachment
    if ((!text && !att) || sending || !activeProjectId) return

    const userMsg: HermesMessage = {
      id: nextId(),
      role: 'user',
      text,
      image: att ? { previewUrl: att.previewUrl, name: att.name } : undefined,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setAttachment(null)
    setAttachError(null)
    requestAnimationFrame(grow)
    setSending(true)

    try {
      const reply = await cockpit().hermesChat.ask(
        activeProjectId,
        text || 'Please review the attached image.',
        att?.path,
      )
      const next: HermesMessage = reply.ok
        ? { id: nextId(), role: 'hermes', text: reply.text }
        : {
            id: nextId(),
            role: 'error',
            text: reply.error || 'Hermes could not answer this turn.',
          }
      setMessages((prev) => [...prev, next])
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'error',
          text: 'Hermes is unreachable right now. Check that it is installed and configured.',
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const newConversation = async () => {
    if (sending) return
    setMessages([])
    setInput('')
    clearAttachment()
    if (activeProjectId) {
      try {
        await cockpit().hermesChat.clear(activeProjectId)
      } catch {
        // Clearing server-side history is best-effort; local reset already happened.
      }
    }
    textareaRef.current?.focus()
  }

  const resetDrag = () => {
    dragDepthRef.current = 0
    setDragging(false)
  }

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event) || noProject) return
    event.preventDefault()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasFileDrag(event) || noProject) return
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
    if (noProject) return
    const file = firstImage(event.dataTransfer.files)
    if (file) void saveImage(file)
    else setAttachError('Drop a PNG, JPG, WebP, or GIF image.')
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (noProject) return
    const file = firstImage(event.clipboardData.files) ?? firstImageFromItems(event.clipboardData.items)
    if (!file) return
    event.preventDefault()
    void saveImage(file)
  }

  const composerDisabled = sending || noProject
  const canSend = !composerDisabled && (Boolean(input.trim()) || Boolean(attachment))
  const placeholder = noProject
    ? 'Open a project to brief Hermes…'
    : sending
      ? 'Hermes is thinking…'
      : 'Message Hermes…  (Enter to send, Shift+Enter newline)'

  return (
    <aside
      ref={panelRef}
      id="hermes-panel"
      className={`hermes__panel ${open ? 'hermes__panel--open' : ''} ${
        dragging ? 'hermes__panel--dragging' : ''
      }`}
      aria-label="Hermes assistant"
      aria-hidden={!open}
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
    >
      <header className="hermes__head">
        <span className="hermes__avatar" aria-hidden>
          <img className="hermes__avatarImg" src={hermesAvatar} alt="" />
        </span>
        <div className="hermes__titles">
          <span className="hermes__eyebrow">assistant</span>
          <span className="hermes__title">Hermes</span>
        </div>
        <button
          type="button"
          className="hermes__reset"
          onClick={newConversation}
          disabled={sending || !hasMessages}
          aria-label="New conversation"
          title="New conversation"
          tabIndex={open ? 0 : -1}
        >
          <IconNewChat width={15} height={15} />
        </button>
        <button
          type="button"
          className="hermes__close"
          onClick={() => toggleHermes(false)}
          aria-label="Close Hermes"
          title="Close (Esc)"
          tabIndex={open ? 0 : -1}
        >
          <IconClose width={15} height={15} />
        </button>
      </header>

      {hasMessages ? (
        <div className="hermes__thread" ref={threadRef} aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`hermes__msg hermes__msg--${m.role}`}>
              {m.image && <img className="hermes__msgImage" src={m.image.previewUrl} alt={m.image.name} />}
              {m.text && (
                <div className="hermes__msgText">
                  {m.role === 'hermes' ? renderHermesText(m.text) : m.text}
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="hermes__msg hermes__msg--hermes hermes__thinking" aria-label="Hermes is thinking">
              <span className="hermes__dot" />
              <span className="hermes__dot" />
              <span className="hermes__dot" />
            </div>
          )}
        </div>
      ) : (
        <div className="hermes__body">
          <span className="hermes__emptyGlyph" aria-hidden>
            <img className="hermes__emptyGlyphImg" src={hermesAvatar} alt="" />
          </span>
          <p className="hermes__emptyTitle">{noProject ? 'No project open' : 'Hermes'}</p>
          {noProject && (
            <p className="hermes__emptyText">
              Open a project first — Hermes works within the context of your active project.
            </p>
          )}
        </div>
      )}

      {dragging && (
        <div className="hermes__drop">
          <div className="hermes__dropIcon">
            <IconImage width={20} height={20} />
          </div>
          <div>
            <div className="hermes__dropTitle">Drop to attach image</div>
            <div className="hermes__dropSub">Sent with your next message.</div>
          </div>
        </div>
      )}

      {(attachment || attaching || attachError) && (
        <div className="hermes__attach">
          {attachment ? (
            <>
              <img className="hermes__attachThumb" src={attachment.previewUrl} alt="" />
              <div className="hermes__attachBody">
                <div className="hermes__attachName">{attachment.name}</div>
                <div className="hermes__attachMeta">{formatBytes(attachment.size)} · ready to send</div>
              </div>
              <button
                type="button"
                className="hermes__attachRemove"
                title="Remove attachment"
                aria-label="Remove attachment"
                onClick={clearAttachment}
              >
                <IconX width={13} height={13} />
              </button>
            </>
          ) : (
            <>
              {attaching ? (
                <div className="hermes__attachLoader" />
              ) : (
                <IconImage width={16} height={16} />
              )}
              <div className="hermes__attachBody">
                <div className="hermes__attachName">
                  {attaching ? 'Attaching image…' : 'Image not attached'}
                </div>
                {attachError && <div className="hermes__attachMeta is-error">{attachError}</div>}
              </div>
              {attachError && (
                <button
                  type="button"
                  className="hermes__attachRemove"
                  title="Dismiss"
                  aria-label="Dismiss"
                  onClick={() => setAttachError(null)}
                >
                  <IconX width={13} height={13} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      <form
        className="hermes__composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <input
          ref={fileInputRef}
          className="hermes__file"
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
          className="hermes__attachBtn"
          title="Attach image"
          aria-label="Attach image"
          disabled={composerDisabled || attaching}
          tabIndex={open ? 0 : -1}
          onClick={() => fileInputRef.current?.click()}
        >
          <IconImage width={16} height={16} />
        </button>
        <textarea
          ref={textareaRef}
          className="hermes__input"
          value={input}
          rows={1}
          onChange={(e) => {
            setInput(e.target.value)
            grow()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={composerDisabled}
          aria-label="Message Hermes"
          tabIndex={open ? 0 : -1}
        />
        <button
          type="submit"
          className="hermes__send"
          disabled={!canSend}
          aria-label="Send message"
          tabIndex={open ? 0 : -1}
        >
          <IconSend width={16} height={16} />
        </button>
      </form>
    </aside>
  )
}
