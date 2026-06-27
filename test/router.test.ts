import { describe, expect, it } from 'vitest'
import { classifyRoute } from '@shared/router'

describe('classifyRoute', () => {
  it('routes planning/architecture work to claude', () => {
    const r = classifyRoute('plan the architecture for the new billing module')
    expect(r.primary.agent).toBe('claude')
    expect(r.primary.requiresApproval).toBe(false)
  })

  it('routes implementation tasks to codex', () => {
    const r = classifyRoute('implement the login form and write unit tests')
    expect(r.primary.agent).toBe('codex')
  })

  it('routes read-only inspection to the local layer as safe', () => {
    const r = classifyRoute('show me the git diff for the nav component')
    expect(r.primary.agent).toBe('local')
    expect(r.primary.risk).toBe('safe')
    expect(r.primary.requiresApproval).toBe(false)
  })

  it('flags deploy/infra intent as dangerous + approval-required', () => {
    const r = classifyRoute('redeploy the api service to production')
    expect(r.primary.agent).toBe('railway')
    expect(r.primary.risk).toBe('dangerous')
    expect(r.primary.requiresApproval).toBe(true)
  })

  it('defaults to chat when nothing matches', () => {
    const r = classifyRoute('hmm')
    expect(r.primary.agent).toBe('chat')
  })

  it('always provides a primary recommendation', () => {
    const r = classifyRoute('fix the failing build')
    expect(r.primary).toBeDefined()
    expect(r.primary.confidence).toBeGreaterThan(0)
  })
})
