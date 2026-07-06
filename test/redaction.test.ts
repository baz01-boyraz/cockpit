import { describe, expect, it } from 'vitest'
import { looksLikeSecret, maskEnvEntry, parseEnvMasked, redactPayload, redactText } from '@shared/redaction'

describe('env masking', () => {
  it('masks secret-looking keys', () => {
    expect(maskEnvEntry('API_KEY', 'abcdef123456').masked).toBe(true)
    expect(maskEnvEntry('DATABASE_URL', 'postgres://u:p@h/db').masked).toBe(true)
  })

  it('leaves non-secret keys untouched', () => {
    const r = maskEnvEntry('NODE_ENV', 'production')
    expect(r.masked).toBe(false)
    expect(r.maskedValue).toBe('production')
  })

  it('masks values that look like credentials even with innocuous keys', () => {
    expect(maskEnvEntry('THING', 'ghp_0123456789abcdefghij0123').masked).toBe(true)
  })

  it('parses an env buffer without leaking secret values', () => {
    const out = parseEnvMasked('API_KEY="sk-abcdefghijklmnopqrstuvwx"\nNODE_ENV=production\n# comment\n')
    const apiKey = out.find((e) => e.key === 'API_KEY')!
    expect(apiKey.masked).toBe(true)
    expect(apiKey.maskedValue).not.toContain('abcdefghijkl')
    expect(out.find((e) => e.key === 'NODE_ENV')?.masked).toBe(false)
  })
})

describe('redactPayload', () => {
  it('redacts secret keys recursively', () => {
    const out = redactPayload({ token: 'xyz', nested: { password: 'p', ok: 1 } }) as Record<string, unknown>
    expect(out.token).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).ok).toBe(1)
  })

  it('redacts secret-shaped string values', () => {
    expect(redactPayload('ghp_0123456789abcdefghij0123')).toBe('[REDACTED]')
    expect(redactPayload('just a normal string')).toBe('just a normal string')
  })
})

describe('expanded secret coverage', () => {
  it('masks bare *_KEY env names, not key-like words', () => {
    expect(maskEnvEntry('STRIPE_KEY', 'whatever-value').masked).toBe(true)
    expect(maskEnvEntry('SENDGRID_KEY', 'whatever-value').masked).toBe(true)
    expect(maskEnvEntry('KEY', 'whatever-value').masked).toBe(true)
    expect(maskEnvEntry('KEYWORD', 'hello').masked).toBe(false)
    expect(maskEnvEntry('MONKEY_PATCH', 'hello').masked).toBe(false)
    expect(maskEnvEntry('KEYBOARD_LAYOUT', 'us').masked).toBe(false)
  })

  it('catches Stripe-style underscore keys', () => {
    expect(looksLikeSecret('sk_live_51H2eKLAbCdEfGh123456')).toBe(true)
    expect(looksLikeSecret('sk_test_4eC39HqLyjWDarjtT1zdp7dc')).toBe(true)
    expect(looksLikeSecret('rk_live_ABCdef1234567890')).toBe(true)
  })

  it('catches connection URLs with embedded credentials for any scheme', () => {
    expect(looksLikeSecret('mongodb://user:hunter2@cluster0.mongodb.net/db')).toBe(true)
    expect(looksLikeSecret('mongodb+srv://user:hunter2@cluster0.mongodb.net/db')).toBe(true)
    expect(looksLikeSecret('mysql://root:root@localhost:3306/app')).toBe(true)
    expect(looksLikeSecret('redis://default:pass@redis.example.com:6379')).toBe(true)
    expect(looksLikeSecret('amqp://guest:guest@rabbit:5672')).toBe(true)
    expect(looksLikeSecret('postgres://u:p@h/db')).toBe(true)
    expect(looksLikeSecret('https://example.com/path')).toBe(false)
  })

  it('catches Google, SendGrid, npm, and GitHub app tokens', () => {
    expect(looksLikeSecret('AIzaSyA1234567890abcdefghijklmnopqrstu')).toBe(true)
    expect(looksLikeSecret('SG.abcdefghijklmnop.qrstuvwxyz1234567890ABCD')).toBe(true)
    expect(looksLikeSecret('npm_abcdefghijklmnopqrstuvwxyz0123456789')).toBe(true)
    expect(looksLikeSecret('ghu_abcdefghijklmnopqrstuv')).toBe(true)
    expect(looksLikeSecret('ghs_abcdefghijklmnopqrstuv')).toBe(true)
    expect(looksLikeSecret('ghr_abcdefghijklmnopqrstuv')).toBe(true)
  })

  it('catches bearer tokens in prose', () => {
    expect(looksLikeSecret('curl -H "Authorization: Bearer abc123def456ghi789jkl012"')).toBe(true)
  })

  it('redacts an OpenRouter-shaped API key (sk-or-v1-…)', () => {
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd'
    expect(looksLikeSecret(key)).toBe(true)
    expect(redactPayload(key)).toBe('[REDACTED]')
    // In a dumped env line it must never survive to an audit/PTY log.
    const line = redactText(`OPENROUTER_API_KEY=${key}`)
    expect(line).not.toContain(key)
    expect(line).toContain('[REDACTED]')
  })

  it('high-entropy fallback masks unknown-vendor env secrets but not hashes or paths', () => {
    // AWS-secret-shaped: 40 chars, mixed case + digits, no vendor signature
    expect(maskEnvEntry('AWS_SK', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLE12').masked).toBe(true)
    // git SHA (pure hex) must survive
    expect(maskEnvEntry('COMMIT', '3f785ce19b1de6d0b9df8f2a3c1e4b5a6d7c8e9f').masked).toBe(false)
    // filesystem paths must survive
    expect(maskEnvEntry('PROJECT_DIR', '/Users/Baz01/BAZWORK/cockpit9/subfolder00').masked).toBe(false)
    expect(maskEnvEntry('GREETING', 'hello world').masked).toBe(false)
  })
})

describe('redactText (terminal/log line scrubbing)', () => {
  it('masks secret values inline while keeping the rest of the line', () => {
    const line =
      'curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij" https://api.example.com'
    const out = redactText(line)
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(out).toContain('https://api.example.com')
  })

  it('masks KEY=VALUE assignments with secret-shaped keys (a dumped .env)', () => {
    const out = redactText('STRIPE_KEY=sk_live_51H2eKLAbCdEfGh123456')
    expect(out).not.toContain('sk_live_')
    expect(out).toContain('STRIPE_KEY=')

    const out2 = redactText('DB_PASSWORD=hunter2')
    expect(out2).not.toContain('hunter2')
    expect(out2).toContain('DB_PASSWORD=')
  })

  it('leaves ordinary build output untouched', () => {
    const tsError = 'error TS2345: Argument of type string is not assignable — src/main.ts:42'
    expect(redactText(tsError)).toBe(tsError)
    const shaLine = 'commit 3f785ce19b1de6d0b9df8f2a3c1e4b5a6d7c8e9f (HEAD -> main)'
    expect(redactText(shaLine)).toBe(shaLine)
    const npmLine = 'added 1204 packages in 12s'
    expect(redactText(npmLine)).toBe(npmLine)
  })
})
