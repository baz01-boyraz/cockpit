import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
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
import { IconImage, IconSearch, IconSend, IconTerminal, IconX } from './icons'

const HISTORY_LIMIT = 80
const TEXTAREA_MAX_HEIGHT = 118

/** Imperative surface for the terminal pane: rerouted typing lands here. */
export interface TerminalComposerHandle {
  focus(): void
  insertText(text: string): void
}

/** Staged image chip rendered inside the composer until the draft is sent. */
export interface ComposerAttachmentView {
  id: string
  name: string
  size: number
  previewUrl: string
  status: 'saving' | 'ready'
}

interface TerminalComposerProps {
  projectId: string
  role: TerminalRole | null
  capturedHistory: readonly string[]
  attachments: readonly ComposerAttachmentView[]
  attachmentError: string | null
  onPickImages: () => void
  onRemoveAttachment: (id: string) => void
  onDismissAttachmentError: () => void
  onFocusChange: (focused: boolean) => void
  onSubmit: (draft: string) => Promise<boolean>
}

function formatChipBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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

export const TerminalComposer = forwardRef<TerminalComposerHandle, TerminalComposerProps>(
  function TerminalComposer(
    {
      projectId,
      role,
      capturedHistory,
      attachments,
      attachmentError,
      onPickImages,
      onRemoveAttachment,
      onDismissAttachmentError,
      onFocusChange,
      onSubmit,
    },
    handleRef,
  ) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendingRef = useRef(false)
  const historyId = useId()
  const storageKey = historyKey(projectId, role)
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

  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => textareaRef.current?.focus(),
      insertText: (text: string) => {
        if (!text) return
        setDraft((prev) => prev + text)
        requestAnimationFrame(() => {
          const textarea = textareaRef.current
          if (!textarea) return
          textarea.focus()
          const end = textarea.value.length
          textarea.setSelectionRange(end, end)
        })
      },
    }),
    [],
  )

  const savingAttachment = attachments.some((item) => item.status === 'saving')
  const readyAttachments = attachments.filter((item) => item.status === 'ready').length

  const submit = async () => {
    if (sendingRef.current) return
    if (savingAttachment) {
      setNotice('Image still saving…')
      return
    }
    sendingRef.current = true
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
      setNotice(
        readyAttachments > 0
          ? `Sent with ${readyAttachments} image${readyAttachments > 1 ? 's' : ''}`
          : 'Sent exactly as written',
      )
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not send input')
    } finally {
      sendingRef.current = false
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
    ? `Write to ${roleLabel} — typing anywhere lands here`
    : 'Type a command — typing anywhere lands here'
  const activeSuggestionId = historyOpen && suggestions[activeSuggestion]
    ? `${historyId}-option-${activeSuggestion}`
    : undefined
  const sendDisabled =
    sending || savingAttachment || (draft.trim().length === 0 && readyAttachments === 0)

  return (
    <div
      className={`termcomposer ${historyOpen ? 'termcomposer--history' : ''}`}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange(false)
      }}
    >
      {historyOpen && (
        <div id={historyId} className="termcomposer__history" role="listbox" aria-label="Terminal history">
          <div className="termcomposer__historyHead">
            <span>Recent input</span>
            <span>{suggestions.length} matches</span>
          </div>
          {suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <button
                key={suggestion}
                id={`${historyId}-option-${index}`}
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

      {(attachments.length > 0 || attachmentError) && (
        <div className="termcomposer__chips" aria-label="Staged image attachments">
          {attachments.map((item) => (
            <div
              key={item.id}
              className={`termcomposer__chip ${
                item.status === 'saving' ? 'termcomposer__chip--saving' : ''
              }`}
            >
              <img className="termcomposer__chipThumb" src={item.previewUrl} alt="" />
              <div className="termcomposer__chipBody">
                <span className="termcomposer__chipName">{item.name}</span>
                <span className="termcomposer__chipMeta">
                  {item.status === 'saving' ? 'Saving…' : formatChipBytes(item.size)}
                </span>
              </div>
              <button
                type="button"
                className="termcomposer__chipRemove"
                aria-label={`Remove ${item.name}`}
                title="Remove image"
                onClick={() => onRemoveAttachment(item.id)}
              >
                <IconX width={11} height={11} />
              </button>
            </div>
          ))}
          {attachmentError && (
            <button
              type="button"
              className="termcomposer__chipError"
              title="Dismiss"
              onClick={onDismissAttachmentError}
            >
              {attachmentError}
              <IconX width={10} height={10} />
            </button>
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
          aria-activedescendant={activeSuggestionId}
          aria-autocomplete="list"
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
          className="termcomposer__attach"
          aria-label="Attach image"
          title="Attach image — or paste / drop one"
          onClick={onPickImages}
        >
          <IconImage width={14} height={14} />
          {attachments.length > 0 && (
            <span className="termcomposer__attachCount">{attachments.length}</span>
          )}
        </button>
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
          disabled={sendDisabled}
          onClick={() => void submit()}
        >
          <IconSend width={14} height={14} />
        </button>
      </div>

      <div className="termcomposer__footer">
        <span className="termcomposer__hint">
          Paste or drop images · <kbd>⌘Z</kbd> undo · <kbd>Shift+Enter</kbd> new line · <kbd>Ctrl+R</kbd> history
        </span>
        <span className="termcomposer__notice" aria-live="polite">{notice}</span>
        <span className="termcomposer__sendHint"><kbd>Enter</kbd> send</span>
      </div>
    </div>
  )
  },
)
