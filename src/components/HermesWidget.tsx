/**
 * Hermes — a minimal floating chat widget. A bottom-right corner bubble that is
 * collapsed by default and expands into a compact chat panel on click.
 *
 * Wired to the real backend (`window.cockpit.hermesChat`): each send is a full
 * agentic turn that can take a while, so the composer locks and a "thinking"
 * indicator shows until the reply resolves. `ok: false` replies are surfaced as
 * a distinct, muted error message in the thread — never a crash or blank screen.
 *
 * Self-contained on purpose (own glyphs + `hermes.css`) so the feature touches no
 * shared UI file. Built on the Obsidian-Ember tokens; animates only transform/opacity.
 */
import { useEffect, useRef, useState } from 'react'
import type { SVGProps } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'

type IconProps = SVGProps<SVGSVGElement>

type HermesRole = 'user' | 'hermes' | 'error'

interface HermesMessage {
  id: string
  role: HermesRole
  text: string
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

/** Hermes mark — a winged messenger spark inside a chat bubble. */
const IconHermes = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L4 19.5l1.4-4.2A7.5 7.5 0 1 1 20 11.5Z" />
    <path d="M12 8.2 13 11l2.8 1-2.8 1-1 2.8-1-2.8L8.2 12l2.8-1 1-2.8Z" />
  </svg>
)

/** Chevron-down — the "collapse" affordance shown while the panel is open. */
const IconChevronDown = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 9.5 12 15l6-5.5" />
  </svg>
)

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

let msgSeq = 0
const nextId = (): string => `hm-${Date.now().toString(36)}-${(msgSeq++).toString(36)}`

export function HermesWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<HermesMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const activeProjectId = useStore((s) => s.activeProjectId)

  const panelRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const noProject = !activeProjectId
  const hasMessages = messages.length > 0

  // Esc closes the panel while it's open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Keep the thread pinned to the newest message / the thinking indicator.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, sending])

  const send = async () => {
    const text = input.trim()
    if (!text || sending || !activeProjectId) return

    const userMsg: HermesMessage = { id: nextId(), role: 'user', text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setSending(true)

    try {
      const reply = await cockpit().hermesChat.ask(activeProjectId, text)
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
    if (activeProjectId) {
      try {
        await cockpit().hermesChat.clear(activeProjectId)
      } catch {
        // Clearing server-side history is best-effort; local reset already happened.
      }
    }
    inputRef.current?.focus()
  }

  const composerDisabled = sending || noProject
  const placeholder = noProject
    ? 'Open a project to brief Hermes…'
    : sending
      ? 'Hermes is thinking…'
      : 'Message Hermes…'

  return (
    <div className={`hermes ${open ? 'hermes--open' : ''}`}>
      <div
        ref={panelRef}
        className="hermes__panel"
        role="dialog"
        aria-label="Hermes assistant"
        aria-modal="false"
        aria-hidden={!open}
      >
        <header className="hermes__head">
          <span className="hermes__avatar" aria-hidden>
            <IconHermes width={17} height={17} />
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
            onClick={() => setOpen(false)}
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
                {m.text}
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
              <IconHermes width={24} height={24} />
            </span>
            <p className="hermes__emptyTitle">
              {noProject ? 'No project open' : 'Brief Hermes'}
            </p>
            <p className="hermes__emptyText">
              {noProject
                ? 'Open a project first — Hermes works within the context of your active project.'
                : 'Ask Hermes to explore the codebase, run a task, or explain what just happened. It can take a moment to think.'}
            </p>
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
            ref={inputRef}
            className="hermes__input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={composerDisabled}
            aria-label="Message Hermes"
            tabIndex={open ? 0 : -1}
          />
          <button
            type="submit"
            className="hermes__send"
            disabled={composerDisabled || !input.trim()}
            aria-label="Send message"
            tabIndex={open ? 0 : -1}
          >
            <IconSend width={16} height={16} />
          </button>
        </form>
      </div>

      <button
        type="button"
        className="hermes__launcher"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={open ? 'Collapse Hermes' : 'Open Hermes assistant'}
        title={open ? 'Collapse Hermes' : 'Hermes assistant'}
      >
        <span className="hermes__launcherGlyph" aria-hidden>
          {open ? <IconChevronDown width={20} height={20} /> : <IconHermes width={22} height={22} />}
        </span>
      </button>
    </div>
  )
}
