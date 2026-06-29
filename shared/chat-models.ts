/**
 * The Claude models the cockpit "chat" panel can answer with.
 *
 * The cockpit shells out to the user's locally-installed `claude` CLI (Claude
 * Code) in print mode, so answers are billed to the user's existing Claude
 * subscription — the app never handles an API key. `id` is the alias passed to
 * `claude --model`; the aliases always resolve to the latest model of each tier.
 *
 * Pure and dependency-free so it runs in the browser mock and is importable
 * directly by the renderer (no IPC round-trip needed for a static list).
 */

export interface ChatModel {
  /** Alias passed to `claude --model`, e.g. `sonnet`, `opus`, `haiku`. */
  id: string
  /** Short label for the picker button + chip, e.g. `Sonnet`. */
  label: string
  /** Full, honest model name, e.g. `Claude Sonnet 4.6`. */
  name: string
  /** One line on when to reach for it. */
  hint: string
}

export const CHAT_MODELS: readonly ChatModel[] = [
  { id: 'sonnet', label: 'Sonnet', name: 'Claude Sonnet 4.6', hint: 'Balanced — best for everyday coding' },
  { id: 'opus', label: 'Opus', name: 'Claude Opus 4.8', hint: 'Deepest reasoning — hard problems' },
  { id: 'haiku', label: 'Haiku', name: 'Claude Haiku 4.5', hint: 'Fastest — quick questions' },
]

export const DEFAULT_CHAT_MODEL: ChatModel = CHAT_MODELS[0]

/** Resolve a requested alias to a known model, falling back to the default. */
export function resolveChatModel(id: string | null | undefined): ChatModel {
  const want = (id ?? '').trim().toLowerCase()
  return CHAT_MODELS.find((m) => m.id === want) ?? DEFAULT_CHAT_MODEL
}
