import type { EngineSpec } from './engines'

/**
 * Model policy for bounded, tool-less Memory analysis.
 *
 * Capture providers and analysis providers are deliberately independent:
 * Claude and Codex produce transcripts; this low-cost seat only extracts or
 * curates candidate knowledge. It never receives tools or write capability.
 */
export const MEMORY_MODEL_POLICY_VERSION = 2 as const

export const MEMORY_ANALYSIS_ENGINE: Readonly<EngineSpec> = {
  engine: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
}

/**
 * Availability chain for the analysis seat. Without it, a missing OpenRouter
 * key or spent credit silently stops ALL memory capture even though the
 * capture sources (the local claude/codex CLIs) are sitting right there.
 * Order is by marginal cost: the codex CLI rides the developer's subscription
 * (empty model = the CLI's configured default); the claude CLI is last because
 * it shares the quota reserved for coding.
 */
export const MEMORY_ANALYSIS_FALLBACKS: readonly Readonly<EngineSpec>[] = [
  { engine: 'codex', model: '' },
  { engine: 'claude', model: 'haiku' },
]

export const MEMORY_ANALYSIS_ROLE = 'bounded-mechanical-analysis' as const

export interface MemoryAnalysisFallbackNotice {
  failed: EngineSpec
  next: EngineSpec
  /** EngineRunner failure text — fixed guidance strings, never key material. */
  failure: string
}

/**
 * Run one bounded analysis prompt through the engine chain: primary first,
 * then each fallback in order. `onFallback` observes every hop (content-free)
 * so the caller can audit an outage; a throwing observer never affects the
 * chain. When every engine fails, the LAST failure propagates — by then it is
 * the local claude CLI's, the engine most likely to be actionable locally.
 */
export async function runMemoryAnalysis(
  call: (spec: EngineSpec) => Promise<string>,
  onFallback?: (notice: MemoryAnalysisFallbackNotice) => void,
): Promise<string> {
  const chain: readonly Readonly<EngineSpec>[] = [MEMORY_ANALYSIS_ENGINE, ...MEMORY_ANALYSIS_FALLBACKS]
  let lastFailure: unknown = new Error('Memory analysis engine chain is empty.')
  for (let i = 0; i < chain.length; i += 1) {
    try {
      return await call(chain[i])
    } catch (err) {
      lastFailure = err
      const next = chain[i + 1]
      if (next && onFallback) {
        try {
          onFallback({
            failed: chain[i],
            next,
            failure: err instanceof Error ? err.message : String(err),
          })
        } catch {
          // The observer is telemetry; it must never decide the chain's fate.
        }
      }
    }
  }
  throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure))
}
