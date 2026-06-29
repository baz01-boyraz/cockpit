import { describe, expect, it } from 'vitest'
import { inferLogLevel, matchLogLine } from '@shared/log-patterns'

describe('matchLogLine', () => {
  it('detects a missing module', () => {
    const m = matchLogLine("Error: Cannot find module 'framer-motion'")
    expect(m?.pattern).toBe('module_not_found')
    expect(m?.suggestedAgent).toBe('codex')
    expect(m?.severity).toBe('high')
  })

  it('detects a port-in-use error', () => {
    const m = matchLogLine('listen EADDRINUSE: address already in use :::3000')
    expect(m?.pattern).toBe('port_in_use')
    expect(m?.suggestedAgent).toBe('local')
  })

  it('detects a TypeScript error code', () => {
    const m = matchLogLine("src/app.ts(12,5): error TS2345: Argument of type 'string'")
    expect(m?.pattern).toBe('ts_error')
    expect(m?.suggestedAgent).toBe('claude')
  })

  it('detects a deploy failure and routes to railway', () => {
    const m = matchLogLine('Deployment failed: service crashed during build')
    expect(m?.pattern).toBe('deploy_failed')
    expect(m?.suggestedAgent).toBe('railway')
  })

  it('returns null for benign output', () => {
    expect(matchLogLine('compiled successfully in 240ms')).toBeNull()
  })
})

describe('inferLogLevel', () => {
  it('classifies error lines', () => {
    expect(inferLogLevel('FATAL: connection refused')).toBe('error')
    expect(inferLogLevel('Build failed')).toBe('error')
  })
  it('classifies warnings', () => {
    expect(inferLogLevel('warning: deprecated API')).toBe('warn')
  })
  it('defaults to info', () => {
    expect(inferLogLevel('server ready on port 3000')).toBe('info')
  })
  it('treats success lines that merely count warnings/errors as info', () => {
    expect(inferLogLevel('lint (0 warnings) ✅')).toBe('info')
    expect(inferLogLevel('typecheck ✓')).toBe('info')
    expect(inferLogLevel('build passed with 0 errors')).toBe('info')
  })
  it('still flags a real failure even next to a check glyph', () => {
    expect(inferLogLevel('✓ step ok — Error: build failed')).toBe('error')
  })
})
