import type { MemoryHubSnapshot } from '@shared/memory-hub'
import type { ForceEdge } from '@shared/forceGraph'

/**
 * Shared vocabulary for the memory graph — the types and tuning constants the
 * data adapter, the paint layer and the orchestrator all speak. No logic lives
 * here so it can be imported freely without pulling in the canvas.
 */

export interface GraphNodeMeta {
  id: string
  label: string
  /** Unresolved wikilink target — a note the hub wants but doesn't have. */
  ghost: boolean
  radius: number
}

export interface GraphData {
  metas: GraphNodeMeta[]
  edges: ForceEdge[]
}

export interface MemoryGraphProps {
  projectId: string
  snapshot: MemoryHubSnapshot
  /** Real-node click → open that note back in the reader. */
  onOpen: (name: string) => void
}

export type Tier = 'amber' | 'ember' | 'glacier' | 'ghost'

/** Per-node visual identity: color, glow sprite, and idle-life phases. */
export interface VMeta {
  color: string
  hot: string
  sprite: HTMLCanvasElement
  degree: number
  driftAmp: number
  driftFx: number
  driftFy: number
  driftPx: number
  driftPy: number
  breatheFx: number
  breathePhase: number
}

/** A signal firing along an edge — travels 0→1 with a fading tail. */
export interface Pulse {
  edge: number
  t: number
  speed: number
  glacier: boolean
}

/** Camera controls the running effect exposes to the overlay buttons. */
export interface GraphControls {
  zoomIn: () => void
  zoomOut: () => void
  reset: () => void
}

export const TICKS_PER_FRAME = 3
export const MAX_SYNC_TICKS = 400
export const CLICK_SLOP_PX = 5
export const HALO_SPRITE = 128
export const PULSE_SPRITE = 28
export const MAX_PULSES = 26
export const LABEL_MAX = 15
export const MIN_SCALE = 0.35
export const MAX_SCALE = 4
