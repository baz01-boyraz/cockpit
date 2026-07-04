import { describe, expect, it } from 'vitest'
import {
  ROLES,
  SPECS,
  ROLE_IDS,
  SPEC_IDS,
  isRole,
  isSpec,
  assignmentLabel,
  assignmentPrompt,
  parseAssignments,
  pipelinePrompt,
  type Assignment,
} from '../shared/agent-taxonomy'

describe('agent-taxonomy catalog', () => {
  it('exposes the six formal roles and six specialisations', () => {
    expect(ROLE_IDS).toEqual(['planner', 'builder', 'reviewer', 'fixer', 'scout', 'tester'])
    expect(SPEC_IDS).toEqual(['frontend', 'backend', 'security', 'types', 'perf', 'db'])
  })

  it('every role and spec carries a label and a non-empty prompt', () => {
    for (const id of ROLE_IDS) {
      expect(ROLES[id].label.length).toBeGreaterThan(0)
      expect(ROLES[id].prompt.length).toBeGreaterThan(0)
    }
    for (const id of SPEC_IDS) {
      expect(SPECS[id].label.length).toBeGreaterThan(0)
      expect(SPECS[id].prompt.length).toBeGreaterThan(0)
    }
  })
})

describe('type guards', () => {
  it('accepts known ids and rejects everything else', () => {
    expect(isRole('builder')).toBe(true)
    expect(isRole('architect')).toBe(false)
    expect(isRole('')).toBe(false)
    expect(isRole(null)).toBe(false)
    expect(isSpec('security')).toBe(true)
    expect(isSpec('devops')).toBe(false)
  })
})

describe('assignmentLabel', () => {
  it('is Role·Spec when a spec is set, bare Role otherwise', () => {
    expect(assignmentLabel({ role: 'builder', spec: 'frontend' })).toBe('Builder·Frontend')
    expect(assignmentLabel({ role: 'planner' })).toBe('Planner')
    expect(assignmentLabel({ role: 'reviewer', spec: null })).toBe('Reviewer')
  })
})

describe('assignmentPrompt', () => {
  it('leads with the role prompt and folds in the spec lens when present', () => {
    const withSpec = assignmentPrompt({ role: 'reviewer', spec: 'security' })
    expect(withSpec).toContain(ROLES.reviewer.prompt)
    expect(withSpec).toContain(SPECS.security.prompt)

    const bare = assignmentPrompt({ role: 'planner' })
    expect(bare).toBe(ROLES.planner.prompt)
  })
})

describe('pipelinePrompt', () => {
  it('prefixes multi-step context so a worker knows its place in the chain', () => {
    const a: Assignment = { role: 'builder', spec: 'backend' }
    const text = pipelinePrompt(a, 1, 3)
    expect(text).toContain('Step 2 of 3')
    expect(text).toContain(assignmentPrompt(a))
  })

  it('omits the step banner for a single-step pipeline', () => {
    const a: Assignment = { role: 'builder' }
    expect(pipelinePrompt(a, 0, 1)).toBe(assignmentPrompt(a))
  })
})

describe('parseAssignments', () => {
  it('keeps only well-formed assignments from untrusted input', () => {
    const raw = [
      { role: 'builder', spec: 'frontend' },
      { role: 'planner' },
      { role: 'bogus', spec: 'frontend' },
      { role: 'reviewer', spec: 'nope' },
      'garbage',
      null,
    ]
    expect(parseAssignments(raw)).toEqual([
      { role: 'builder', spec: 'frontend' },
      { role: 'planner', spec: null },
      { role: 'reviewer', spec: null },
    ])
  })

  it('returns an empty list for non-array input', () => {
    expect(parseAssignments(undefined)).toEqual([])
    expect(parseAssignments('[]')).toEqual([])
    expect(parseAssignments({})).toEqual([])
  })
})
