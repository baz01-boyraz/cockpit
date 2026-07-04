import { describe, expect, it } from 'vitest'
import { classifyRoles } from '../shared/role-router'
import type { Role } from '../shared/agent-taxonomy'

const roles = (title: string, body = ''): Role[] =>
  classifyRoles(title, body).pipeline.map((s) => s.role)

describe('classifyRoles — single intent', () => {
  it('routes an implementation task to a builder', () => {
    expect(roles('Add a contact form to the landing page')).toContain('builder')
  })

  it('routes a bug/failure task to a fixer', () => {
    expect(roles('Fix the crash when the login request returns 500')).toContain('fixer')
  })

  it('routes a research task to a scout', () => {
    expect(roles('Research which charting library fits our bundle budget')).toContain('scout')
  })

  it('falls back to a builder when nothing matches', () => {
    const r = classifyRoles('', '')
    expect(r.pipeline.length).toBeGreaterThan(0)
    expect(r.pipeline[0].role).toBe('builder')
  })
})

describe('classifyRoles — multi-agent pipelines', () => {
  it('splits "plan then implement then review" into an ordered pipeline', () => {
    const r = classifyRoles('Plan and implement the auth API, then review it for security', '')
    const seq = r.pipeline.map((s) => s.role)
    expect(seq).toContain('planner')
    expect(seq).toContain('builder')
    expect(seq).toContain('reviewer')
    // Canonical execution order: planning leads, review trails.
    expect(seq.indexOf('planner')).toBeLessThan(seq.indexOf('builder'))
    expect(seq.indexOf('builder')).toBeLessThan(seq.indexOf('reviewer'))
  })

  it('pairs a fix with a test when both are asked for', () => {
    const seq = roles('Fix the failing checkout test and add coverage for the edge case')
    expect(seq).toContain('fixer')
    expect(seq).toContain('tester')
    expect(seq.indexOf('fixer')).toBeLessThan(seq.indexOf('tester'))
  })

  it('attaches a domain spec when the wording is strong', () => {
    const r = classifyRoles('Review the auth token handling for injection and secret leaks', '')
    const reviewer = r.pipeline.find((s) => s.role === 'reviewer')
    expect(reviewer?.spec).toBe('security')
  })

  it('reads the body as well as the title', () => {
    const seq = roles('Contact form', 'Also write unit tests for the validation schema')
    expect(seq).toContain('tester')
  })
})

describe('classifyRoles — output shape', () => {
  it('every step carries a rationale and a bounded confidence', () => {
    const r = classifyRoles('Plan and build the dashboard', '')
    expect(r.rationale.length).toBeGreaterThan(0)
    for (const step of r.pipeline) {
      expect(step.rationale.length).toBeGreaterThan(0)
      expect(step.confidence).toBeGreaterThan(0)
      expect(step.confidence).toBeLessThanOrEqual(1)
    }
  })

  it('caps the pipeline to a sane length', () => {
    const r = classifyRoles(
      'plan design implement build fix debug review audit test cover research explore',
      '',
    )
    expect(r.pipeline.length).toBeLessThanOrEqual(4)
  })
})
