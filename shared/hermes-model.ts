/**
 * Reads the active inference model out of a Hermes `config.yaml` and turns it
 * into a short, honest display label for the cockpit "model" chip.
 *
 * We deliberately avoid a YAML dependency: `shared/` must stay
 * runtime-dependency-free so it also runs in the browser mock. We only need two
 * leaf values from the top-level `model:` block, so a small targeted reader is
 * both sufficient and safer than dragging in a parser.
 */

export interface HermesModel {
  /** Provider id as Hermes records it, e.g. `openai-codex`, `anthropic`, `nous`. */
  provider: string
  /** Default model id, e.g. `gpt-5.5`, `claude-opus-4-8`. */
  model: string
}

const FALLBACK_LABEL = 'agent'

function stripValue(raw: string): string {
  let v = raw.trim()
  // Strip a trailing inline comment only when the value is not quoted — model
  // and provider ids never contain `#`, so a bare `#` reliably starts a comment.
  if (!v.startsWith('"') && !v.startsWith("'")) {
    const hash = v.indexOf('#')
    if (hash !== -1) v = v.slice(0, hash).trim()
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1)
  }
  return v.trim()
}

/**
 * Pull `default` (model id) and `provider` out of the top-level `model:` block.
 * Returns null when the file has no `model:` block at all, so callers can tell
 * "Hermes not configured" apart from "configured with empty values".
 */
export function parseHermesModelConfig(yamlText: string): HermesModel | null {
  const lines = yamlText.split(/\r?\n/)
  let inBlock = false
  let found = false
  let provider = ''
  let model = ''

  for (const line of lines) {
    if (!inBlock) {
      if (/^model:\s*(#.*)?$/.test(line)) {
        inBlock = true
        found = true
      }
      continue
    }
    // A non-indented, non-empty line (e.g. `model_catalog:`) ends the block.
    if (line.trim() !== '' && !/^\s/.test(line)) break
    const m = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/)
    if (!m) continue
    if (m[1] === 'default') model = stripValue(m[2])
    else if (m[1] === 'provider') provider = stripValue(m[2])
  }

  if (!found) return null
  return { provider, model }
}

/** Title-case a dash/underscore-separated id, leaving numeric tokens untouched. */
function titleCaseWords(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => (/[a-zA-Z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Turn a raw model id into a short, human display label.
 *   gpt-5.5          → GPT-5.5
 *   claude-opus-4-8  → Claude Opus 4.8
 *   hermes-4         → Hermes 4
 *   some-local-model → Some Local Model
 *   ''               → agent
 */
export function humanizeModelLabel(model: string): string {
  const id = model.trim()
  if (!id) return FALLBACK_LABEL

  // GPT family: brand the prefix, keep the rest verbatim (handles 4o, 5.5).
  if (/^gpt/i.test(id)) return id.replace(/^gpt/i, 'GPT')

  // Modern Claude: claude-<tier>-<maj>-<min> → Claude <Tier> <maj>.<min>
  if (/^claude-/i.test(id)) {
    const parts = id.split('-').slice(1)
    const tier = parts.shift() ?? ''
    const version = parts.filter((p) => /^\d+$/.test(p)).join('.')
    const tierLabel = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : ''
    return ['Claude', tierLabel, version].filter(Boolean).join(' ')
  }

  return titleCaseWords(id)
}
