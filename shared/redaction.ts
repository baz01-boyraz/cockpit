/**
 * Secret redaction utilities (pure, no runtime deps — safe to unit test).
 *
 * Security rule: the renderer must never receive raw secrets, and nothing
 * secret-shaped should ever be attached to AI context or the audit log. These
 * helpers mask values defensively. They are intentionally conservative: when in
 * doubt, mask.
 */

/** Keys whose values are always treated as secret regardless of content. */
const SECRET_KEY_PATTERN =
  /(pass(word)?|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth|credential|bearer|session|cookie|dsn|connection[_-]?string)/i

/**
 * Bare `KEY` as its own name segment (`STRIPE_KEY`, `KEY`, `SENDGRID_KEY`).
 * The segment boundary keeps ordinary words (`KEYWORD`, `MONKEY_PATCH`,
 * `KEYBOARD_LAYOUT`) unmasked.
 */
const BARE_KEY_SEGMENT = /(^|[_-])key($|[_-])/i

/** Value shapes that look like credentials even when the key is innocuous. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9-_]{16,}/, // OpenAI / Anthropic style
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/, // Stripe (underscore, not hyphen)
  /gh[po]_[A-Za-z0-9]{20,}/, // GitHub PAT / OAuth
  /gh[usr]_[A-Za-z0-9]{20,}/, // GitHub app / server / refresh tokens
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /AIza[0-9A-Za-z_-]{30,}/, // Google API key
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, // SendGrid
  /\bnpm_[A-Za-z0-9]{30,}/, // npm automation token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  // Any scheme URL with embedded user:password credentials (postgres, mongodb,
  // mysql, redis, amqp, http, …). Plain URLs without a password never match.
  /\b[a-zA-Z][a-zA-Z0-9+.-]{1,24}:\/\/[^\s:/@]+:[^\s@]+@/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i, // Authorization header token in prose
]

/** Pre-built global copies for inline text scrubbing (redactText). */
const SECRET_VALUE_PATTERNS_GLOBAL = SECRET_VALUE_PATTERNS.map(
  (re) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`),
)

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || BARE_KEY_SEGMENT.test(key)
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value))
}

/**
 * Last line of defense for env-style values with no vendor signature (e.g. AWS
 * secret access keys): a long, spaceless, mixed-case token with digits is
 * treated as secret. Pure hex (git SHAs, digests) and filesystem paths are
 * explicitly excluded so everyday values stay readable.
 */
function hasHighEntropy(value: string): boolean {
  const token = value.trim()
  if (token.length < 32 || token.length > 512) return false
  if (/\s/.test(token)) return false
  if (token.startsWith('/') || token.startsWith('./') || token.startsWith('~')) return false
  if (/^[0-9a-f]+$/i.test(token)) return false
  if (!/[A-Z]/.test(token) || !/[a-z]/.test(token) || !/[0-9]/.test(token)) return false
  return /^[A-Za-z0-9+/_=-]+$/.test(token)
}

/**
 * Mask a single value, preserving a short hint of its length so the UI can show
 * "set but hidden" without leaking content.
 */
export function maskValue(value: string): string {
  if (value.length === 0) return ''
  if (value.length <= 4) return '••••'
  const head = value.slice(0, 2)
  return `${head}${'•'.repeat(Math.min(10, value.length - 2))}`
}

/** Mask the value of a single env entry if key or value looks sensitive. */
export function maskEnvEntry(key: string, value: string): { maskedValue: string; masked: boolean } {
  if (isSecretKey(key) || looksLikeSecret(value) || hasHighEntropy(value)) {
    return { maskedValue: maskValue(value), masked: true }
  }
  return { maskedValue: value, masked: false }
}

/**
 * `KEY=VALUE` / `KEY: VALUE` assignments inside free text (an echoed `.env`,
 * an `export` line, a JSON fragment). The separator is captured so the line
 * keeps its original shape after masking.
 */
const KEY_VALUE_ASSIGNMENT = /([A-Za-z_][A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/g

/**
 * Scrub secret-shaped content out of a line of free text (terminal output, log
 * lines) while leaving the rest of the line readable. Two passes: known secret
 * value shapes anywhere in the line, then values assigned to secret-shaped
 * keys. Deliberately does NOT apply the high-entropy heuristic — build output
 * is full of long hashes that are not secrets.
 */
export function redactText(text: string): string {
  let out = text
  for (const re of SECRET_VALUE_PATTERNS_GLOBAL) {
    out = out.replace(re, '[REDACTED]')
  }
  out = out.replace(KEY_VALUE_ASSIGNMENT, (match, key: string, sep: string) =>
    isSecretKey(key) ? `${key}${sep}[REDACTED]` : match,
  )
  return out
}

/** Parse a `.env`-style buffer into masked entries. Never returns raw secrets. */
export function parseEnvMasked(content: string): { key: string; maskedValue: string; masked: boolean }[] {
  const out: { key: string; maskedValue: string; masked: boolean }[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out.push({ key, ...maskEnvEntry(key, value) })
  }
  return out
}

/**
 * Recursively redact secret-shaped values from an arbitrary payload before it
 * is written to the audit log or shown to the renderer.
 */
export function redactPayload(input: unknown, depth = 0): unknown {
  if (depth > 6) return '[…]'
  if (typeof input === 'string') {
    return looksLikeSecret(input) ? '[REDACTED]' : input
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactPayload(v, depth + 1))
  }
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (isSecretKey(k)) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redactPayload(v, depth + 1)
      }
    }
    return out
  }
  return input
}
