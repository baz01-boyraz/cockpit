import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { TerminalRole } from '@shared/domain'
import {
  buildTerminalHistorySuggestions,
  rememberTerminalHistory,
} from '@shared/terminal-ux'
import { IconSearch, IconSend, IconTerminal } from './icons'

const HISTORY_LIMIT = 80
const TEXTAREA_MAX_HEIGHT = 118

interface TerminalComposerProps {
  projectId: string
  role: TerminalRole | null
  capturedHistory: readonly string[]
  onSubmit: (draft: string) => Promise<boolean>
}

function historyRole(role: TerminalRole | null): string {
  if (role === 'claude' || role === 'codex') return role
  return 'shell'
}

function historyKey(projectId: string, role: TerminalRole | null): string {
  return `cockpit:terminal-composer:${projectId}:${historyRole(role)}`
}

function readHistory(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string').slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function writeHistory(key: string, history: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(history.slice(0, HISTORY_LIMIT)))
  } catch {
    // History is a convenience; private/blocked storage must never break input.
  }
}

function oneLinePreview(value: string): string {
  return value.replace(/\n/g, ' ↵ ')
}

export function TerminalComposer({
  projectId,
  role,
  capturedHistory,
  onSubmit,
}: TerminalComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const historyId = useId()
  const storageKey = useMemo(() => historyKey(projectId, role), [projectId, role])
  const [draft, setDraft] = useState('')
  const [localHistory, setLocalHistory] = useState<string[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setLocalHistory(readHistory(storageKey))
  }, [storageKey])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
  }, [draft])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const suggestions = useMemo(
    () =>
      buildTerminalHistorySuggestions(draft, [
        ...localHistory,
        ...capturedHistory,
      ]),
    [capturedHistory, draft, localHistory],
  )

  useEffect(() => {
    setActiveSuggestion((current) => Math.min(current, Math.max(0, suggestions.length - 1)))
  }, [suggestions.length])

  const selectSuggestion = (suggestion: string) => {
    setDraft(suggestion)
    setHistoryOpen(false)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(suggestion.length, suggestion.length)
    })
  }

  const submit = async () => {
    if (sending) return
    setSending(true)
    setNotice(null)
    try {
      const submitted = await onSubmit(draft)
      if (!submitted) return
      const nextHistory = rememberTerminalHistory(localHistory, draft, HISTORY_LIMIT)
      setLocalHistory(nextHistory)
      writeHistory(storageKey, nextHistory)
      setDraft('')
      setHistoryOpen(false)
      setActiveSuggestion(0)
      setNotice('Sent exactly as written')
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send input')
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as globalThis.KeyboardEvent
    if (nativeEvent.isComposing) return

    if (event.ctrlKey && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      setHistoryOpen((open) => !open)
      setActiveSuggestion(0)
      return
    }

    if (event.key === 'Escape' && historyOpen) {
      event.preventDefault()
      setHistoryOpen(false)
      return
    }

    if (historyOpen && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveSuggestion((current) => (current + 1) % suggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length)
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        selectSuggestion(suggestions[activeSuggestion])
        return
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (historyOpen && suggestions[activeSuggestion]) {
        selectSuggestion(suggestions[activeSuggestion])
        return
      }
      void submit()
    }
  }

  const roleLabel = role === 'claude' ? 'Claude' : role === 'codex' ? 'Codex' : 'Shell'
  const placeholder = role === 'claude' || role === 'codex'
    ? 'Write a message — click anywhere to edit'
    : 'Type a command — click anywhere to edit'

  return (
    <div className={`termcomposer ${historyOpen ? 'termcomposer--history' : ''}`}>
      {historyOpen && (
        <div id={historyId} className="termcomposer__history" role="listbox" aria-label="Terminal history">
          <div className="termcomposer__historyHead">
            <span>Recent input</span>
            <span>{suggestions.length} matches</span>
          </div>
          {suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <button
                key={`${suggestion}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeSuggestion}
                className={`termcomposer__historyItem ${
                  index === activeSuggestion ? 'termcomposer__historyItem--active' : ''
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
              >
                <IconTerminal width={12} height={12} />
                <span>{oneLinePreview(suggestion)}</span>
              </button>
            ))
          ) : (
            <div className="termcomposer__historyEmpty">No matching history yet.</div>
          )}
        </div>
      )}

      <div className="termcomposer__editor">
        <div className="termcomposer__identity" aria-hidden="true">
          <span className="termcomposer__spark" />
          <span>{roleLabel}</span>
        </div>
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          className="termcomposer__input mono"
          aria-label="Terminal composer"
          aria-controls={historyOpen ? historyId : undefined}
          aria-expanded={historyOpen}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={`termcomposer__historyButton ${historyOpen ? 'termcomposer__historyButton--on' : ''}`}
          aria-label="Search terminal history"
          aria-expanded={historyOpen}
          aria-controls={historyId}
          title="Search history (Ctrl+R)"
          onClick={() => {
            setHistoryOpen((open) => !open)
            setActiveSuggestion(0)
            textareaRef.current?.focus()
          }}
        >
          <IconSearch width={14} height={14} />
        </button>
        <button
          type="button"
          className="termcomposer__send"
          aria-label="Send terminal input"
          title="Send (Enter)"
          disabled={sending || draft.trim().length === 0}
          onClick={() => void submit()}
        >
          <IconSend width={14} height={14} />
        </button>
      </div>

      <div className="termcomposer__footer">
        <span className="termcomposer__hint">
          Click to place cursor · <kbd>⌘Z</kbd> undo · <kbd>Shift+Enter</kbd> new line · <kbd>Ctrl+R</kbd> history
        </span>
        <span className="termcomposer__notice" aria-live="polite">{notice}</span>
        <span className="termcomposer__sendHint"><kbd>Enter</kbd> send</span>
      </div>
    </div>
  )
}
