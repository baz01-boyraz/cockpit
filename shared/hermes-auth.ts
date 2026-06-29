/**
 * Parses `hermes auth list` output into the set of authenticated providers, so
 * the cockpit can offer real provider choices without ever touching the
 * credentials themselves. Pure and dependency-free.
 */

export interface HermesProvider {
  /** Provider id Hermes uses, e.g. `anthropic`, `openai-codex`, `openrouter`. */
  id: string
  /** How many pooled credentials are stored for it. */
  credentials: number
}

/**
 * Each provider is a header line like `openai-codex (1 credentials):` followed
 * by indented credential rows (which we ignore — they may name secret sources).
 */
export function parseHermesAuthList(text: string): HermesProvider[] {
  const out: HermesProvider[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s+\((\d+)\s+credentials?\):/)
    if (m) out.push({ id: m[1], credentials: Number(m[2]) })
  }
  return out
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: 'Claude',
  'openai-codex': 'Codex',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  copilot: 'Copilot',
  nous: 'Nous',
  'nous-portal': 'Nous',
}

/** Friendly, brand-recognizable label for a provider id (best effort). */
export function friendlyProvider(id: string): string {
  const key = id.trim().toLowerCase()
  if (PROVIDER_LABELS[key]) return PROVIDER_LABELS[key]
  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
