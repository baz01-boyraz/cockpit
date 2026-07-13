import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalAttachment, TerminalSession } from '@shared/domain'
import { OSC_COMMAND } from '@shared/command-blocks'
import {
  buildComposerMessage,
  buildTerminalComposerSubmission,
  isTerminalCopyShortcut,
  shouldRouteKeyToComposer,
} from '@shared/terminal-ux'
import { cockpit } from '../lib/cockpit'
import { CommandBlockDecorations } from '../lib/commandBlocks'
import { NativeInputMask } from '../lib/nativeInputMask'
import { useSessionBlocks } from '../store/blockStore'
import { BlocksView } from './BlocksView'
import { TerminalComposer, type TerminalComposerHandle } from './TerminalComposer'
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
  firstImage,
  firstImageFromItems,
  hasFileDrag,
  inferImageMime,
  readBase64,
} from '../lib/imageAttach'
import { IconChevron, IconCopy, IconImage, IconTerminal, IconX } from './icons'

type TerminalViewMode = 'stream' | 'blocks'

/** Image staged in the composer; `saved` lands once the main process wrote it. */
type StagedAttachment = {
  id: string
  name: string
  size: number
  previewUrl: string
  status: 'saving' | 'ready'
  saved: TerminalAttachment | null
}

const MAX_STAGED_IMAGES = 4

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

export function TerminalView({ session, active }: { session: TerminalSession; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const decorationsRef = useRef<CommandBlockDecorations | null>(null)
  const inputMaskRef = useRef<NativeInputMask | null>(null)
  const composerRef = useRef<TerminalComposerHandle | null>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<StagedAttachment[]>([])
  const attachmentsRef = useRef<StagedAttachment[]>([])
  const [mode, setMode] = useState<TerminalViewMode>('stream')
  const [hasSelection, setHasSelection] = useState(false)
  const [atLiveOutput, setAtLiveOutput] = useState(true)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)
  const isCodex = session.role === 'codex'
  // Block capture lives app-level in blockStore (survives pane unmounts);
  // this pane only renders its session's published snapshots.
  const blocks = useSessionBlocks(session.id)
  const capturedHistory = useMemo(
    () => blocks.slice().reverse().map((block) => block.command).filter(Boolean),
    [blocks],
  )

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
    const inputMask = new NativeInputMask(term, THEME.background)
    inputMaskRef.current = inputMask
    const offOsc = term.parser.registerOscHandler(OSC_COMMAND, (payload) => {
      decorations.handlePayload(payload)
      return true
    })

    // Block capture happens app-level (blockStore's single onData subscriber);
    // this pane's subscription only paints the live xterm stream.
    const api = cockpit()
    const syncLiveOutput = () => {
      setAtLiveOutput(term.buffer.active.viewportY >= term.buffer.active.baseY)
      inputMask.sync()
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
      if (isTerminalCopyShortcut(event, { hasSelection: term.hasSelection(), isMac })) {
        const selection = term.getSelection()
        if (selection) {
          void navigator.clipboard.writeText(selection).then(
            () => setCopyNotice('Copied'),
            () => setCopyNotice('Copy unavailable'),
          )
        }
        return false
      }

      // One writing place: plain typing aimed at the terminal flows into the
      // composer. Navigation, chords, and alt-screen apps stay terminal-native.
      if (
        shouldRouteKeyToComposer(event, {
          alternateScreen: term.buffer.active.type === 'alternate',
        })
      ) {
        if (event.type === 'keydown') composerRef.current?.insertText(event.key)
        return false
      }
      return true
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
      inputMask.dispose()
      inputMaskRef.current = null
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
          composerRef.current?.focus()
        } catch {
          /* ignore */
        }
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [active, session.id])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

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
    if (!error) return
    const timeout = window.setTimeout(() => setError(null), 5200)
    return () => window.clearTimeout(timeout)
  }, [error])

  useEffect(() => {
    if (!copyNotice) return
    const timeout = window.setTimeout(() => setCopyNotice(null), 1800)
    return () => window.clearTimeout(timeout)
  }, [copyNotice])

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
    composerRef.current?.focus()
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((item) => item.id !== id)
    })
  }

  const submitComposerDraft = async (draft: string): Promise<boolean> => {
    const term = termRef.current
    const isAgent = session.role === 'claude' || session.role === 'codex'
    const ready = attachmentsRef.current.filter(
      (item): item is StagedAttachment & { saved: TerminalAttachment } =>
        item.status === 'ready' && item.saved !== null,
    )
    // Agent sessions hold the project cwd, so the short relative path is
    // enough; a shell may have cd'd away and needs the absolute one.
    const message = buildComposerMessage(
      draft,
      ready.map((item) => (isAgent ? item.saved.relativePath : item.saved.path)),
    )
    if (!message) return false
    const submission = buildTerminalComposerSubmission(
      message,
      term?.modes.bracketedPasteMode ?? false,
    )
    if (!submission) return false

    setMode('stream')
    await cockpit().terminals.write(session.id, submission.data)
    if (ready.length > 0) {
      const sentIds = new Set(ready.map((item) => item.id))
      setAttachments((prev) => {
        prev.forEach((item) => {
          if (sentIds.has(item.id)) URL.revokeObjectURL(item.previewUrl)
        })
        return prev.filter((item) => !sentIds.has(item.id))
      })
    }
    term?.scrollToBottom()
    setAtLiveOutput(true)
    return true
  }

  const rerunCommand = (command: string) => {
    if (!command) return
    void cockpit().terminals.write(session.id, `${command}\r`)
    setMode('stream')
    composerRef.current?.focus()
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
    if (attachmentsRef.current.length >= MAX_STAGED_IMAGES) {
      setError(`Up to ${MAX_STAGED_IMAGES} images per message.`)
      return
    }

    const stageId = `stage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const previewUrl = URL.createObjectURL(file)
    const staged: StagedAttachment = {
      id: stageId,
      name: file.name,
      size: file.size,
      previewUrl,
      status: 'saving',
      saved: null,
    }
    setError(null)
    // Mirror synchronously so back-to-back drops respect the cap before render.
    attachmentsRef.current = [...attachmentsRef.current, staged]
    setAttachments((prev) => [...prev, staged])
    try {
      const dataBase64 = await readBase64(file)
      const saved = await cockpit().terminals.attachImage({
        projectId: session.projectId,
        sessionId: session.id,
        fileName: file.name,
        mimeType,
        dataBase64,
      })
      setAttachments((prev) =>
        prev.map((item) =>
          item.id === stageId ? { ...item, size: saved.size, status: 'ready', saved } : item,
        ),
      )
      composerRef.current?.focus()
    } catch (err) {
      URL.revokeObjectURL(previewUrl)
      setAttachments((prev) => prev.filter((item) => item.id !== stageId))
      setError(err instanceof Error ? err.message : 'Could not attach image.')
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
    const images = Array.from(event.dataTransfer.files).filter((file) => inferImageMime(file))
    if (images.length === 0) {
      setError('Drop a PNG, JPG, WebP, or GIF image.')
      return
    }
    images.forEach((file) => void saveImage(file))
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const file = firstImage(event.clipboardData.files) ?? firstImageFromItems(event.clipboardData.items)
    if (file) {
      event.preventDefault()
      event.stopPropagation()
      void saveImage(file)
      return
    }

    // Text pasted at the terminal belongs to the one writing place too —
    // unless an alt-screen app (vim & co) is in charge of the keyboard.
    const target = event.target instanceof HTMLElement ? event.target : null
    if (!target || !hostRef.current?.contains(target)) return
    if (termRef.current?.buffer.active.type === 'alternate') return
    const text = event.clipboardData.getData('text/plain')
    if (!text) return
    event.preventDefault()
    event.stopPropagation()
    composerRef.current?.insertText(text)
  }

  return (
    <div
      className={`termview ${dragging ? 'termview--dragging' : ''} ${
        mode === 'blocks' ? 'termview--blocks' : ''
      } ${isCodex ? 'termview--codex' : ''}`}
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

        </div>

        {dragging && (
          <div className="termview__drop">
            <div className="termview__dropIcon">
              <IconImage width={22} height={22} />
            </div>
            <div>
              <div className="termview__dropTitle">Drop to attach image</div>
              <div className="termview__dropSub">Staged in the composer — sent with your next message.</div>
            </div>
          </div>
        )}
      </div>

      <TerminalComposer
        ref={composerRef}
        projectId={session.projectId}
        role={session.role}
        capturedHistory={capturedHistory}
        attachments={attachments}
        attachmentError={error}
        onPickImages={() => fileInputRef.current?.click()}
        onRemoveAttachment={removeAttachment}
        onDismissAttachmentError={() => setError(null)}
        onFocusChange={(focused) => inputMaskRef.current?.setComposerFocused(focused)}
        onSubmit={submitComposerDraft}
      />

      <input
        ref={fileInputRef}
        className="termview__file"
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          files.forEach((file) => void saveImage(file))
        }}
      />
    </div>
  )
}
