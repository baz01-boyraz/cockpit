import type { EngineSpec } from './engines'

/**
 * Model policy for bounded, tool-less Memory analysis.
 *
 * Capture providers and analysis providers are deliberately independent:
 * Claude and Codex produce transcripts; this low-cost seat only extracts or
 * curates candidate knowledge. It never receives tools or write capability.
 */
export const MEMORY_MODEL_POLICY_VERSION = 1 as const

export const MEMORY_ANALYSIS_ENGINE: Readonly<EngineSpec> = {
  engine: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
}

export const MEMORY_ANALYSIS_ROLE = 'bounded-mechanical-analysis' as const
