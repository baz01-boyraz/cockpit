import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalAttachment, TerminalSession } from '@shared/domain'
import type { MemoryContextReceipt } from '@shared/memory-context'
import { OSC_COMMAND } from '@shared/command-blocks'
import { isTerminalCopyShortcut, normalizePromptDraft } from '@shared/terminal-ux'
import { cockpit } from '../lib/cockpit'
import { CommandBlockDecorations } from '../lib/commandBlocks'
import { useSessionBlocks } from '../store/blockStore'
import { BlocksView } from './BlocksView'
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
import { IconChevron, IconCopy, IconImage, IconSend, IconTerminal, IconX } from './icons'

type TerminalViewMode = 'stream' | 'blocks'

type AttachmentPreview = TerminalAttachment & {
  previewUrl: string
  sent: boolean
}

const THEME = {
  background: '#0e0f13',
  foreground: '#ece6da',
  cursor: '#e07b45',
  cursorAccent: '#0e0f13',
  selectionBackground: 'rgba(224,123,69,0.28)',
  black: '#14161c',
  red: '#e2563d',
  green: '#93c46a',
  yellow: '#e3a93f',
  blue: '#6fa8c4',
  magenta: '#c08bd0',
  cyan: '#5fb3b3',
  white: '#ece6da',
  brightBlack: '#645f57',
  brightRed: '#f0786a',
  brightGreen: '#c4e35a',
  brightYellow: '#f0c06a',
  brightBlue: '#8fc4dc',
  brightMagenta: '#d6a8e0',
  brightCyan: '#8fd6d6',
  brightWhite: '#ffffff',
}

export function agentPromptPlaceholder(agent: 'claude' | 'codex'): string {
  const label = agent === 'claude' ? 'Claude Code' : 'Codex'
  return `Write here with normal editing, then send it into ${label}…`
}

export function memoryReceiptHint(receipt: MemoryContextReceipt | null): string {
  if (!receipt) return ' · every task'
  if (receipt.status === 'unavailable') return ' · unavailable'
  if (receipt.delivery === 'lookup') return ' · agent lookup'
  if (receipt.delivery === 'inline') {
    return ` · ${receipt.notes.length} hook${receipt.notes.length === 1 ? '' : 's'}`
  }
  return ' · no match'
}

export function TerminalView({ session, active }: { session: TerminalSession; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const promptInputRef = useRef<HTMLTextAreaElement>(null)
  const dragDepthRef = useRef(0)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const decorationsRef = useRef<CommandBlockDecorations | null>(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<AttachmentPreview | null>(null)
  const [mode, setMode] = useState<TerminalViewMode>('stream')
  const [hasSelection, setHasSelection] = useState(false)
  const [atLiveOutput, setAtLiveOutput] = useState(true)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState('')
  const [preparingPrompt, setPreparingPrompt] = useState(false)
  const [memoryReceipt, setMemoryReceipt] = useState<MemoryContextReceipt | null>(null)
  const isCodex = session.role === 'codex'
  const isAgent = isCodex || session.role === 'claude'
  const agentLabel = isCodex ? 'Codex' : 'Claude Code'
  // Block capture lives app-level in blockStore (survives pane unmounts);
  // this pane only renders its session's published snapshots.
  const blocks = useSessionBlocks(session.id)

  const resetDrag = () => {
    dragDepthRef.current = 0
    setDragging(false)
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: "'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      letterSpacing: 0.2,
      cursorBlink: true,
      theme: THEME,
      allowProposedApi: true,
      scrollback: 5000,
      scrollOnUserInput: true,
      smoothScrollDuration: 110,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    try {
      fit.fit()
    } catch {
      /* host not measured yet */
    }
    termRef.current = term
    fitRef.current = fit

    // Warp-style command blocks: consume OSC 133 semantic-prompt marks and paint
    // per-command gutter/ruler decorations. Returning true stops xterm rendering
    // the (invisible) control sequence.
    const decorations = new CommandBlockDecorations(term)
    decorationsRef.current = decorations
    const offOsc = term.parser.registerOscHandler(OSC_COMMAND, (payload) => {
      decorations.handlePayload(payload)
      return true
    })

    // Block capture happens app-level (blockStore's single onData subscriber);
    // this pane's subscription only paints the live xterm stream.
    const api = cockpit()
    const syncLiveOutput = () => {
      setAtLiveOutput(term.buffer.active.viewportY >= term.buffer.active.baseY)
    }
    const offData = api.terminals.onData((chunk) => {
      if (chunk.sessionId !== session.id) return
      term.write(chunk.data, syncLiveOutput)
    })
    const sub = term.onData((data) => void api.terminals.write(session.id, data))
    const selectionSub = term.onSelectionChange(() => setHasSelection(term.hasSelection()))
    const scrollSub = term.onScroll(syncLiveOutput)
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
    term.attachCustomKeyEventHandler((event) => {
      if (!isTerminalCopyShortcut(event, { hasSelection: term.hasSelection(), isMac })) return true
      const selection = term.getSelection()
      if (selection) {
        void navigator.clipboard.writeText(selection).then(
          () => setCopyNotice('Copied'),
          () => setCopyNotice('Copy unavailable'),
        )
      }
      return false
    })

    const fitAndResize = () => {
      if (host.clientWidth < 20 || host.clientHeight < 20) return
      try {
        fit.fit()
        api.terminals.resize(session.id, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    }

    requestAnimationFrame(fitAndResize)
    const ro = new ResizeObserver(fitAndResize)
    ro.observe(host)

    return () => {
      offData()
      sub.dispose()
      selectionSub.dispose()
      scrollSub.dispose()
      offOsc.dispose()
      decorations.dispose()
      decorationsRef.current = null
      ro.disconnect()
      term.dispose()
      termRef.current = null
      setHasSelection(false)
      setAtLiveOutput(true)
    }
  }, [session.id])

  useEffect(() => {
    if (active && fitRef.current) {
      const frame = requestAnimationFrame(() => {
        const host = hostRef.current
        const term = termRef.current
        const fit = fitRef.current
        if (!host || !term || !fit || host.clientWidth < 20 || host.clientHeight < 20) return
        try {
          fit.fit()
          cockpit().terminals.resize(session.id, term.cols, term.rows)
          term.focus()
        } catch {
          /* ignore */
        }
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [active, session.id])

  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [attachment?.previewUrl])

  useEffect(() => {
    const clear = () => resetDrag()
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  useEffect(() => {
    if (!attachment?.sent) return
    const timeout = window.setTimeout(() => {
      setAttachment((current) => (current?.id === attachment.id ? null : current))
    }, 3200)
    return () => window.clearTimeout(timeout)
  }, [attachment?.id, attachment?.sent])

  useEffect(() => {
    if (!copyNotice) return
    const timeout = window.setTimeout(() => setCopyNotice(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [copyNotice])

  useEffect(() => {
    if (!promptOpen) return
    const frame = requestAnimationFrame(() => promptInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [promptOpen])

  const copyTerminalSelection = async () => {
    const term = termRef.current
    const selection = term?.getSelection() ?? ''
    if (!selection) return
    try {
      await navigator.clipboard.writeText(selection)
      setCopyNotice('Copied')
    } catch {
      setCopyNotice('Copy unavailable')
    }
    term?.focus()
  }

  const scrollTerminal = (pages: number) => {
    termRef.current?.scrollPages(pages)
  }

  const jumpToLiveOutput = () => {
    termRef.current?.scrollToBottom()
    termRef.current?.focus()
  }

  const clearCurrentInput = () => {
    void cockpit().terminals.write(session.id, '\x15')
    termRef.current?.focus()
  }

  const submitPromptDraft = async () => {
    const prompt = normalizePromptDraft(promptDraft)
    const term = termRef.current
    if (!prompt || !term) return
    setPreparingPrompt(true)
    setError(null)
    try {
      // Main returns either a compact lookup contract or the original prompt
      // unchanged. Full note bodies never pass through the terminal composer.
      // xterm wraps the result in bracketed-paste markers for either agent TUI.
      const prepared = await cockpit().terminals.prepareAgentPrompt(session.id, prompt)
      term.paste(prepared.prompt)
      await cockpit().terminals.write(session.id, '\r')
      setMemoryReceipt(prepared.memory)
      setPromptDraft('')
      term.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the memory-backed task.')
    } finally {
      setPreparingPrompt(false)
    }
  }

  const sendAttachmentPath = async (target: TerminalAttachment) => {
    const line = `Screenshot attached: ${JSON.stringify(target.path)}`
    await cockpit().terminals.write(session.id, `${line}\r`)
    termRef.current?.focus()
  }

  const rerunCommand = (command: string) => {
    if (!command) return
    void cockpit().terminals.write(session.id, `${command}\r`)
    setMode('stream')
    termRef.current?.focus()
  }

  const saveImage = async (file: File) => {
    const mimeType = inferImageMime(file)
    if (!mimeType) {
      setError('Use PNG, JPG, WebP, or GIF.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image must be 10 MB or smaller.')
      return
    }

    const previewUrl = URL.createObjectURL(file)
    setSaving(true)
    setError(null)
    try {
      const dataBase64 = await readBase64(file)
      const saved = await cockpit().terminals.attachImage({
        projectId: session.projectId,
        sessionId: session.id,
        fileName: file.name,
        mimeType,
        dataBase64,
      })
      await sendAttachmentPath(saved)
      setAttachment({ ...saved, previewUrl, sent: true })
    } catch (err) {
      URL.revokeObjectURL(previewUrl)
      setError(err instanceof Error ? err.message : 'Could not send image.')
    } finally {
      setSaving(false)
    }
  }

  const sendCurrentAttachment = async () => {
    if (!attachment) return
    setError(null)
    try {
      await sendAttachmentPath(attachment)
      setAttachment((current) => (current ? { ...current, sent: true } : current))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send image.')
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current += 1
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFileDrag(event)) return
    event.preventDefault()
    event.stopPropagation()
    resetDrag()
    const file = firstImage(event.dataTransfer.files)
    if (file) void saveImage(file)
    else setError('Drop a PNG, JPG, WebP, or GIF image.')
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = firstImage(event.clipboardData.files) ?? firstImageFromItems(event.clipboardData.items)
    if (!file) return
    event.preventDefault()
    event.stopPropagation()
    void saveImage(file)
  }

  const canSubmitPrompt = normalizePromptDraft(promptDraft) !== null

  return (
    <div
      className={`termview ${dragging ? 'termview--dragging' : ''} ${saving ? 'termview--saving' : ''} ${
        mode === 'blocks' ? 'termview--blocks' : ''
      } ${isCodex ? 'termview--codex' : ''} ${promptOpen ? 'termview--promptOpen' : ''}`}
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
      onPasteCapture={handlePaste}
    >
      <div className="termview__surface">
        <div className="termview__host" ref={hostRef} />
        {mode === 'blocks' && (
          <BlocksView blocks={blocks} projectId={session.projectId} onRerun={rerunCommand} />
        )}

        <div className="termview__toolbar">
          <div className="termview__viewtoggle" role="tablist" aria-label="Terminal view">
            <button
              role="tab"
              aria-selected={mode === 'stream'}
              className={`termview__seg ${mode === 'stream' ? 'termview__seg--on' : ''}`}
              onClick={() => setMode('stream')}
              title="Live terminal stream"
            >
              <IconTerminal width={12} height={12} /> Stream
            </button>
            <button
              role="tab"
              aria-selected={mode === 'blocks'}
              className={`termview__seg ${mode === 'blocks' ? 'termview__seg--on' : ''}`}
              onClick={() => setMode('blocks')}
              title="Foldable command blocks"
            >
              Blocks
              {blocks.length > 0 && <span className="termview__segcount">{blocks.length}</span>}
            </button>
          </div>

          {mode === 'stream' && (hasSelection || copyNotice) && (
            <button
              type="button"
              className={`termview__copy ${copyNotice === 'Copied' ? 'termview__copy--done' : ''}`}
              aria-label="Copy terminal selection"
              disabled={!hasSelection}
              onClick={() => void copyTerminalSelection()}
            >
              <IconCopy width={12} height={12} />
              <span>{copyNotice ?? 'Copy'}</span>
            </button>
          )}

          {mode === 'stream' && (
            <div className="termview__nav" aria-label="Terminal scroll controls">
              <button
                type="button"
                className="termview__navbtn"
                aria-label="Scroll terminal up one page"
                title="Page up"
                onClick={() => scrollTerminal(-1)}
              >
                <IconChevron width={13} height={13} className="termview__navup" />
              </button>
              <button
                type="button"
                className="termview__navbtn"
                aria-label="Scroll terminal down one page"
                title="Page down"
                onClick={() => scrollTerminal(1)}
              >
                <IconChevron width={13} height={13} className="termview__navdown" />
              </button>
              <button
                type="button"
                className={`termview__navbtn termview__navbtn--latest ${
                  atLiveOutput ? '' : 'termview__navbtn--behind'
                }`}
                aria-label="Jump to live terminal output"
                aria-pressed={atLiveOutput}
                title={atLiveOutput ? 'Live output' : 'Jump to live output'}
                onClick={jumpToLiveOutput}
              >
                <IconChevron width={13} height={13} className="termview__navdown" />
              </button>
            </div>
          )}

          {mode === 'stream' && isCodex && (
            <button
              type="button"
              className="termview__clearInput"
              aria-label="Clear current Codex input"
              title="Clear the current Codex input (Ctrl+U)"
              onClick={clearCurrentInput}
            >
              <IconX width={12} height={12} />
            </button>
          )}

          {mode === 'stream' && (
            <button
              type="button"
              className="termview__attach"
              title="Send screenshot"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
            >
              <IconImage width={14} height={14} />
            </button>
          )}
        </div>

        {dragging && (
          <div className="termview__drop">
            <div className="termview__dropIcon">
              <IconImage width={22} height={22} />
            </div>
            <div>
              <div className="termview__dropTitle">Drop to send image</div>
              <div className="termview__dropSub">Saved into this project, then sent to this terminal.</div>
            </div>
          </div>
        )}

        {(attachment || error || saving) && (
          <div className={`termattach ${attachment ? 'termattach--ready' : ''}`}>
            {attachment ? (
              <>
                <img className="termattach__thumb" src={attachment.previewUrl} alt="" />
                <div className="termattach__body">
                  <div className="termattach__name">{attachment.name}</div>
                  <div className="termattach__path mono">{attachment.relativePath}</div>
                  <div className="termattach__meta">
                    <span>{formatBytes(attachment.size)}</span>
                    {attachment.sent && <span className="termattach__ok">sent to terminal</span>}
                  </div>
                </div>
                <div className="termattach__actions">
                  <button
                    className="iconbtn termattach__send"
                    title="Send again"
                    onClick={() => void sendCurrentAttachment()}
                  >
                    <IconImage width={12} height={12} />
                  </button>
                  <button className="iconbtn" title="Dismiss" onClick={() => setAttachment(null)}>
                    <IconX width={13} height={13} />
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="termattach__loader" />
                <div className="termattach__body">
                  <div className="termattach__name">{saving ? 'Saving image...' : 'Image not attached'}</div>
                  <div className="termattach__path">{error ?? 'Preparing project attachment.'}</div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        className="termview__file"
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void saveImage(file)
        }}
      />

      {isAgent && (
        <section
          className={`codexdock ${promptOpen ? 'codexdock--open' : ''}`}
          aria-label={`${agentLabel} prompt dock`}
        >
          {promptOpen ? (
            <>
              <div className="codexdock__head">
                <span className="codexdock__title">
                  <IconSend width={12} height={12} /> Prompt dock
                </span>
                <span className="codexdock__headHint">
                  Memory lookup
                  {memoryReceiptHint(memoryReceipt)}
                </span>
                <button
                  type="button"
                  className="codexdock__close"
                  aria-label="Close Codex prompt dock"
                  onClick={() => {
                    setPromptOpen(false)
                    termRef.current?.focus()
                  }}
                >
                  <IconX width={12} height={12} />
                </button>
              </div>
              <textarea
                ref={promptInputRef}
                id={`codex-prompt-${session.id}`}
                className="codexdock__input"
                aria-label="Compose Codex prompt"
                placeholder={agentPromptPlaceholder(isCodex ? 'codex' : 'claude')}
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void submitPromptDraft()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setPromptOpen(false)
                    termRef.current?.focus()
                  }
                }}
                rows={3}
              />
              <div className="codexdock__foot">
                <span className="codexdock__shortcut">
                  <kbd>⌘</kbd><kbd>↵</kbd> send
                </span>
                <button
                  type="button"
                  className="codexdock__clear"
                  disabled={promptDraft.length === 0}
                  onClick={() => {
                    setPromptDraft('')
                    promptInputRef.current?.focus()
                  }}
                >
                  Clear draft
                </button>
                <button
                  type="button"
                  className="codexdock__send"
                  disabled={!canSubmitPrompt || preparingPrompt}
                  onClick={() => void submitPromptDraft()}
                >
                  <IconSend width={12} height={12} />
                  {preparingPrompt ? 'Checking memory…' : `Send to ${agentLabel}`}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="codexdock__launcher"
              aria-expanded="false"
              aria-controls={`codex-prompt-${session.id}`}
              onClick={() => setPromptOpen(true)}
            >
              <IconSend width={12} height={12} />
              <span>Draft a prompt</span>
              <small>Memory lookup · normal edit · paste · undo · multi-line</small>
            </button>
          )}
        </section>
      )}
    </div>
  )
}
