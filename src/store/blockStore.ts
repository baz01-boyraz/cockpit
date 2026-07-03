/**
 * Command-block state, lifted out of TerminalView (VISION 3.1).
 *
 * Two layers, deliberately separate:
 *   - a module-level registry of live `CommandBlockModel`s keyed by sessionId —
 *     mutable class instances never enter the reactive store;
 *   - a small zustand store holding immutable SNAPSHOTS per session, published
 *     on a per-session requestAnimationFrame so a chatty pty can't render-storm
 *     subscribers.
 *
 * Capture is fed by ONE app-level `terminals.onData` subscription (see
 * `initBlockCapture`), not by each mounted pane — blocks survive pane
 * unmounts/project switches, are addressable from anywhere by sessionId
 * (the Phase 4 "review block with AI" seam), and the per-pane scan work from
 * the old design collapses into a single subscriber.
 */
import { create } from 'zustand'
import { CommandBlockModel, type CapturedBlock } from '@shared/command-blocks'
import { initialTerminalScanState, scanTerminalChunk, type TerminalScanState } from '@shared/log-sanitize'
import { cockpit } from '../lib/cockpit'

interface BlockState {
  bySession: Record<string, CapturedBlock[]>
  publish: (sessionId: string, blocks: CapturedBlock[]) => void
}

export const useBlockStore = create<BlockState>((set) => ({
  bySession: {},
  publish: (sessionId, blocks) =>
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: blocks } })),
}))

const EMPTY_BLOCKS: CapturedBlock[] = []

/** Stable-reference selector for one session's blocks. */
export function useSessionBlocks(sessionId: string): CapturedBlock[] {
  return useBlockStore((s) => s.bySession[sessionId] ?? EMPTY_BLOCKS)
}

interface CaptureEntry {
  model: CommandBlockModel
  scan: TerminalScanState
  raf: number | null
}

const captures = new Map<string, CaptureEntry>()

function entryFor(sessionId: string): CaptureEntry {
  let entry = captures.get(sessionId)
  if (!entry) {
    entry = { model: new CommandBlockModel(), scan: initialTerminalScanState(), raf: null }
    captures.set(sessionId, entry)
  }
  return entry
}

/** Read a captured block by id — the seam Phase 4's block→AI review uses. */
export function findBlock(sessionId: string, blockId: number): CapturedBlock | null {
  const entry = captures.get(sessionId)
  if (!entry) return null
  return entry.model.snapshot().find((b) => b.id === blockId) ?? null
}

function feed(sessionId: string, data: string, now: number): void {
  const entry = entryFor(sessionId)
  const scanned = scanTerminalChunk(data, entry.scan)
  entry.scan = scanned.state
  entry.model.setSuppressed(scanned.suppress)
  if (!entry.model.feed(data, now)) return
  if (entry.raf !== null) return
  entry.raf = requestAnimationFrame(() => {
    entry.raf = null
    useBlockStore.getState().publish(sessionId, entry.model.snapshot())
  })
}

/**
 * Start the single app-level capture subscription. Idempotent per call site —
 * call once from App; returns the unsubscribe for effect cleanup.
 */
export function initBlockCapture(): () => void {
  const off = cockpit().terminals.onData((chunk) => {
    feed(chunk.sessionId, chunk.data, Date.now())
  })
  return () => {
    off()
    for (const entry of captures.values()) {
      if (entry.raf !== null) cancelAnimationFrame(entry.raf)
      entry.raf = null
    }
  }
}
