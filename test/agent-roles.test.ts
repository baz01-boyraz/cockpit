import { describe, expect, it } from 'vitest'
import { AGENT_ROLES, COUNCIL_PERSONA_IDS, PERSONAS, personaById, rolePromptFor } from '../shared/agent-roles'
import { buildWorkerPrompt } from '../shared/swarm-worker'

describe('agent roles & personas (6.5)', () => {
  it('ships the four roles and at least three persona lenses', () => {
    expect(Object.keys(AGENT_ROLES).sort()).toEqual(['builder', 'planner', 'reviewer', 'scout'])
    expect(PERSONAS.length).toBeGreaterThanOrEqual(3)
    expect(COUNCIL_PERSONA_IDS).toEqual(PERSONAS.map((p) => p.id))
  })

  it('rolePromptFor composes role + persona and ignores unknown ids', () => {
    const text = rolePromptFor('reviewer', 'security-paranoid')
    expect(text).toContain('REVIEWER')
    expect(text).toContain('security veteran')
    expect(rolePromptFor('bogus', 'nope')).toBe('')
    expect(rolePromptFor(null, null)).toBe('')
  })

  it('personaById resolves only catalog ids', () => {
    expect(personaById('type-zealot')?.label).toBe('Type-safety zealot')
    expect(personaById('made-up')).toBeNull()
    expect(personaById(null)).toBeNull()
  })

  it('the worker prompt carries the role text ahead of the card', () => {
    const p = buildWorkerPrompt({ title: 'T', body: 'B' }, [], rolePromptFor('scout', null))
    expect(p.indexOf('SCOUT')).toBeGreaterThan(-1)
    expect(p.indexOf('SCOUT')).toBeLessThan(p.indexOf('CARD: T'))
  })
})
