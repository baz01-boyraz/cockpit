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
  /(pass(word)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth|credential|bearer|session|cookie|dsn|connection[_-]?string)/i

/** Value shapes that look like credentials even when the key is innocuous. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9-_]{16,}/, // OpenAI / Anthropic style
  /ghp_[A-Za-z0-9]{20,}/, // GitHub PAT
  /gho_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT
  /postgres(?:ql)?:\/\/[^\s]+:[^\s]+@/, // db url with creds
]

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

export function looksLikeSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value))
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
  if (isSecretKey(key) || looksLikeSecret(value)) {
    return { maskedValue: maskValue(value), masked: true }
  }
  return { maskedValue: value, masked: false }
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
