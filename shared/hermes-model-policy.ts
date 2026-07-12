/**
 * Canonical Hermes model routing. High-judgment conversation/orchestration uses
 * Pro; bounded, tool-less background analysis uses Flash. Keeping the provider
 * slugs here prevents individual services and docs from silently drifting.
 */
export const HERMES_MODEL_POLICY_VERSION = 1 as const

export const HERMES_MAIN_MODEL = 'deepseek/deepseek-v4-pro' as const
export const HERMES_BACKGROUND_MODEL = 'deepseek/deepseek-v4-flash' as const

export const HERMES_MODEL_POLICY = {
  version: HERMES_MODEL_POLICY_VERSION,
  main: {
    model: HERMES_MAIN_MODEL,
    role: 'conversation-orchestration',
  },
  background: {
    model: HERMES_BACKGROUND_MODEL,
    role: 'bounded-mechanical-analysis',
    tools: false,
  },
} as const
