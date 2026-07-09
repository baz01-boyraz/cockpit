/**
 * Relevance-ranked memory recall (Faz D). Pure and dependency-free: given a query
 * (a card's title/body, a spec) and a set of hub notes, order the notes so the
 * ones whose name/hook overlap the query surface first — with recency (the
 * caller's input order) as the tie-break and the score-0 floor. The old behavior
 * (newest-first pointers) is preserved when nothing matches, so this only ever
 * SHARPENS recall, never removes a note the current code would have shown.
 *
 * Runs in the browser mock and unit tests, so it must stay free of node/crypto.
 */

/**
 * A tiny stopword set — English basics plus common Turkish function words (Baz
 * writes bilingually). Deliberately small: the goal is to drop noise words that
 * would match everything, not to build a real stemmer.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'has', 'have', 'had', 'not', 'but', 'you', 'your', 'our', 'its', 'into',
  'out', 'off', 'per', 'via', 'can', 'will', 'all', 'any', 'how', 'why',
  'when', 'where', 'which', 'then', 'than',
  // Turkish
  've', 'ile', 'bir', 'şu', 'için', 'ama', 'veya', 'değil', 'olan',
  'gibi', 'daha', 'çok', 'olarak', 'var', 'yok', 'ise',
])

/**
 * Lowercase, split on any non-letter/non-digit run (Unicode-aware so Turkish
 * letters like ç/ğ/ı/ö/ş/ü stay INSIDE tokens — "değil" must not shatter into
 * "de"/"il"), then drop tokens shorter than 3 chars and the stopword list.
 */
export function tokenize(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return []
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
}

export interface RankableNote {
  name: string
  hook?: string | null
}

export interface RankedNote {
  name: string
  hook: string | null
}

/**
 * Order `notes` by relevance to `queryText`, returning at most `limit`.
 *
 * Score = for every distinct query token, +2 if it appears among the note's NAME
 * tokens and +1 if it appears among its HOOK tokens (a token in both scores 3).
 * The name is weighted higher because a kebab-case slug is the human's chosen
 * label for the fact. Ties (including the all-zero case) keep the caller's input
 * order — callers pass notes newest-first, so recency is the tie-break and the
 * floor: zero-overlap notes still fill the remaining slots in recency order,
 * exactly reproducing today's "newest pointers" behavior when nothing matches.
 */
export function rankNotes(
  queryText: string,
  notes: readonly RankableNote[],
  limit: number,
): RankedNote[] {
  if (limit <= 0 || notes.length === 0) return []
  const query = new Set(tokenize(queryText))
  const scored = notes.map((note, index) => {
    const hook = note.hook ?? null
    let score = 0
    if (query.size > 0) {
      const nameTokens = new Set(tokenize(note.name))
      const hookTokens = new Set(tokenize(hook ?? ''))
      for (const token of query) {
        if (nameTokens.has(token)) score += 2
        if (hookTokens.has(token)) score += 1
      }
    }
    return { name: note.name, hook, index, score }
  })
  // Highest score first; equal scores keep input (recency) order via the index.
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.slice(0, limit).map(({ name, hook }) => ({ name, hook }))
}

/** Default caps for the council's inline memory block (see composeMemoryPointerBlock). */
export const MEMORY_POINTER_MAX_NOTES = 5
export const MEMORY_POINTER_MAX_CHARS = 900

/**
 * C0 control chars (minus the whitespace ones \t\n\r\f\v, which the \s collapse
 * below folds anyway) plus DEL. Built from an ASCII string so no literal control
 * byte ever appears in source (and the no-control-regex lint rule stays quiet).
 */
// eslint-disable-next-line no-control-regex -- matching control chars IS this sanitizer's job
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000E-\\u001F\\u007F]', 'g')

/** Collapse a hook to one clean line: strip control chars and fold any whitespace
 *  run into a single space. Hooks are our own content but still ride into an LLM
 *  prompt as ONE line, so a stray CR/ESC/newline must never leak. */
function cleanHook(s: string): string {
  return s.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Build the inline "Project memory pointers" block for a prompt: the top-N
 * relevant notes rendered as `name — hook` (or just `name` when a note has no
 * hook), TOTAL capped at `maxChars`. Returns null when nothing is relevant/fits.
 *
 * This is how memory reaches an engine that CANNOT read files (OpenRouter council
 * seats) — the hook must be inline. It is trusted project content, so the caller
 * places it OUTSIDE any untrusted-data fence, clearly labeled; control chars are
 * stripped here as defense in depth.
 */
export function composeMemoryPointerBlock(
  queryText: string,
  notes: readonly RankableNote[],
  opts: { maxNotes?: number; maxChars?: number } = {},
): string | null {
  const maxNotes = opts.maxNotes ?? MEMORY_POINTER_MAX_NOTES
  const maxChars = opts.maxChars ?? MEMORY_POINTER_MAX_CHARS
  const ranked = rankNotes(queryText, notes, maxNotes)
  if (ranked.length === 0) return null

  const header =
    'Project memory pointers (our own hub notes — trusted context, NOT the material under review):'
  const lines = [header]
  let used = header.length + 1
  for (const note of ranked) {
    const hook = note.hook ? cleanHook(note.hook) : ''
    const line = hook ? `- ${note.name} — ${hook}` : `- ${note.name}`
    if (used + line.length + 1 > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  // Only the header fit — nothing useful to say.
  if (lines.length === 1) return null
  return lines.join('\n')
}
