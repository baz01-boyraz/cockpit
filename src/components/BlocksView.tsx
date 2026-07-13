import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CapturedBlock, TerminalCommandStatus } from '@shared/command-blocks'
import type { ReviewResult } from '@shared/review'
import { ansiToHtml } from '@shared/ansi-to-html'
import { formatDuration, relativeTime } from '@shared/time'
import { HERMES_RUNTIME_ENABLED } from '@shared/hermes-runtime'
import { cockpit } from '../lib/cockpit'
import { ReviewFindings, reviewFailure } from './ReviewFindings'
import { IconChevron, IconCopy, IconCheck, IconRestart, IconShieldSearch, IconTerminal } from './icons'

interface BlocksViewProps {
  blocks: CapturedBlock[]
  /** Owning project — the block→review bridge reviews within its boundary. */
  projectId: string
  /** Re-run a captured command (writes it back to the live terminal). */
  onRerun: (command: string) => void
}

const STATUS_TEXT: Record<TerminalCommandStatus, string> = {
  running: 'running',
  success: 'exit 0',
  error: 'error',
  aborted: 'aborted',
}

function statusLabel(block: CapturedBlock): string {
  if (block.status === 'error') return `exit ${block.exitCode ?? '?'}`
  return STATUS_TEXT[block.status]
}

interface BlockCardProps {
  block: CapturedBlock
  projectId: string
  onRerun: (command: string) => void
}

function BlockCard({ block, projectId, onRerun }: BlockCardProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [review, setReview] = useState<ReviewResult | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const outputHtml = useMemo(() => ansiToHtml(block.output), [block.output])
  const hasOutput = block.output.trim().length > 0

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(id)
  }, [copied])

  const copy = async () => {
    const text = block.command + (block.output ? `\n${block.output}` : '')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      /* clipboard unavailable (e.g. insecure context) — ignore */
    }
  }

  // Block → review bridge: the captured command + output travel through the
  // SAME sanitizer boundary as a diff review. Re-click while running = no-op.
  const runReview = async () => {
    if (reviewing) return
    setReviewing(true)
    try {
      const res = await cockpit().review.runText(projectId, {
        label: block.command,
        content: `$ ${block.command}\n${block.output}`,
      })
      setReview(res)
    } catch (err) {
      setReview(reviewFailure(err))
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div className={`cmdcard cmdcard--${block.status}`}>
      <div className="cmdcard__head">
        <button
          className="cmdcard__fold"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Expand output' : 'Collapse output'}
          aria-expanded={!collapsed}
        >
          <IconChevron width={12} height={12} className={collapsed ? 'cmdcard__chevron' : 'cmdcard__chevron cmdcard__chevron--open'} />
        </button>
        <span className={`cmdcard__status cmdcard__status--${block.status}`}>
          <span className="cmdcard__dot" />
          {statusLabel(block)}
        </span>
        <code className="cmdcard__command" title={block.command}>
          {block.command || '(no command)'}
        </code>
        <span className="cmdcard__meta">
          {block.durationMs !== undefined && <span className="cmdcard__dur mono">{formatDuration(block.durationMs)}</span>}
          <span className="cmdcard__time mono" title={new Date(block.startedAt).toLocaleString()}>
            {block.status === 'running' ? 'live' : relativeTime(new Date(block.startedAt).toISOString())}
          </span>
        </span>
        <span className="cmdcard__actions">
          <button className="iconbtn" title="Copy command and output" onClick={() => void copy()}>
            {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
          </button>
          <button
            className="iconbtn"
            title="Run this command again"
            disabled={!block.command}
            onClick={() => onRerun(block.command)}
          >
            <IconRestart width={13} height={13} />
          </button>
          {HERMES_RUNTIME_ENABLED && (
            <button
              className={`iconbtn ${reviewing ? 'iconbtn--busy' : ''}`}
              title="Review this block with AI"
              disabled={!block.command && !hasOutput}
              onClick={() => void runReview()}
            >
              <IconShieldSearch width={13} height={13} />
            </button>
          )}
        </span>
      </div>
      {!collapsed && (
        <div className="cmdcard__body">
          {hasOutput ? (
            <pre className="cmdcard__output" dangerouslySetInnerHTML={{ __html: outputHtml }} />
          ) : block.status === 'running' ? (
            <div className="cmdcard__pending">running…</div>
          ) : (
            <div className="cmdcard__empty">no output</div>
          )}
        </div>
      )}
      {(reviewing || review) && (
        <div className="cmdcard__review">
          {reviewing ? (
            <div className="review__busy review__busy--compact">
              <span className="review__pulse" aria-hidden />
              Reviewing this block…
            </div>
          ) : review ? (
            <ReviewFindings result={review} compact />
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * Warp-style foldable command blocks. xterm can't fold line ranges inline, so this
 * view renders the captured command history (see `CommandBlockModel`) as true DOM
 * cards: each shows the command, an exit-status pill, duration and timestamp, and
 * collapsible ANSI-coloured output. It overlays the live terminal when toggled on.
 */
export function BlocksView({ blocks, projectId, onRerun }: BlocksViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const lastCount = useRef(blocks.length)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const grew = blocks.length > lastCount.current
    lastCount.current = blocks.length
    if (atBottomRef.current || grew) el.scrollTop = el.scrollHeight
  }, [blocks])

  if (blocks.length === 0) {
    return (
      <div className="termblocks termblocks--empty">
        <div className="termblocks__hint">
          <IconTerminal width={20} height={20} />
          <div className="termblocks__hintTitle">No commands captured yet</div>
          <div className="termblocks__hintSub">Run a command and it appears here as a foldable block.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="termblocks" ref={scrollRef} onScroll={onScroll}>
      {blocks.map((block) => (
        <BlockCard key={block.id} block={block} projectId={projectId} onRerun={onRerun} />
      ))}
    </div>
  )
}
