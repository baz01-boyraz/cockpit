import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { TerminalAttachment, TerminalSession } from '@shared/domain'
import { cockpit } from '../lib/cockpit'
import { IconImage, IconX } from './icons'

type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

type AttachmentPreview = TerminalAttachment & {
  previewUrl: string
  sent: boolean
}

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const IMAGE_MIME_TYPES = new Set<ImageMimeType>(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const IMAGE_MIME_BY_EXT: Record<string, ImageMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

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

function inferImageMime(file: File): ImageMimeType | null {
  if (IMAGE_MIME_TYPES.has(file.type as ImageMimeType)) return file.type as ImageMimeType
  const ext = file.name.split('.').pop()?.toLowerCase()
  return ext ? IMAGE_MIME_BY_EXT[ext] ?? null : null
}

function firstImage(files: FileList): File | null {
  for (let i = 0; i < files.length; i += 1) {
    const file = files.item(i)
    if (file && inferImageMime(file)) return file
  }
  return null
}

function firstImageFromItems(items: DataTransferItemList): File | null {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    if (item.kind !== 'file') continue
    const file = item.getAsFile()
    if (file && inferImageMime(file)) return file
  }
  return null
}

function hasFileDrag(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read image.'))
    reader.readAsDataURL(file)
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TerminalView({ session, active }: { session: TerminalSession; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<AttachmentPreview | null>(null)

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

    const api = cockpit()
    const offData = api.terminals.onData((chunk) => {
      if (chunk.sessionId === session.id) term.write(chunk.data)
    })
    const sub = term.onData((data) => void api.terminals.write(session.id, data))

    const onResize = () => {
      try {
        fit.fit()
        api.terminals.resize(session.id, term.cols, term.rows)
      } catch {
        /* ignore */
      }
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    return () => {
      offData()
      sub.dispose()
      ro.disconnect()
      term.dispose()
      termRef.current = null
    }
  }, [session.id])

  useEffect(() => {
    if (active && fitRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
        } catch {
          /* ignore */
        }
      })
    }
  }, [active])

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
    }, 5000)
    return () => window.clearTimeout(timeout)
  }, [attachment?.id, attachment?.sent])

  const sendAttachmentPath = async (target: TerminalAttachment) => {
    const line = `Screenshot attached: ${JSON.stringify(target.path)}`
    await cockpit().terminals.write(session.id, `${line}\r`)
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

  return (
    <div
      className={`termview ${dragging ? 'termview--dragging' : ''} ${saving ? 'termview--saving' : ''}`}
      onDragEnterCapture={handleDragEnter}
      onDragOverCapture={handleDragOver}
      onDragLeaveCapture={handleDragLeave}
      onDropCapture={handleDrop}
      onPasteCapture={handlePaste}
    >
      <div className="termview__host" ref={hostRef} />
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
      <button
        className="termview__attach"
        title="Send screenshot"
        disabled={saving}
        onClick={() => fileInputRef.current?.click()}
      >
        <IconImage width={14} height={14} />
      </button>

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
                <button className="btn btn--accent btn--sm" onClick={() => void sendCurrentAttachment()}>
                  <IconImage width={12} height={12} /> Send again
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
  )
}
