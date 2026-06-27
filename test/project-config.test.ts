import { describe, expect, it } from 'vitest'
import { projectConfigSchema } from '@shared/schemas'

describe('projectConfigSchema', () => {
  it('fills sensible defaults from a minimal config', () => {
    const cfg = projectConfigSchema.parse({
      version: 1,
      project: { name: 'Demo', path: '/tmp/demo' },
    })
    expect(cfg.terminals.max).toBe(6)
    expect(cfg.project.techStack).toEqual([])
    expect(cfg.safety.requireApprovalFor).toContain('git_force_push')
    expect(cfg.railway.projectId).toBeNull()
  })

  it('caps terminals.max at 6', () => {
    const parsed = projectConfigSchema.safeParse({
      version: 1,
      project: { name: 'X', path: '/x' },
      terminals: { max: 99, layout: [], profiles: [] },
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown approval action', () => {
    const parsed = projectConfigSchema.safeParse({
      version: 1,
      project: { name: 'X', path: '/x' },
      safety: { requireApprovalFor: ['not_a_real_action'] },
    })
    expect(parsed.success).toBe(false)
  })
})
