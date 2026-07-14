import { describe, expect, it } from 'vitest'
import { memoryNoteActivitySchema } from '../shared/schemas'

describe('Memory note activity scope contract', () => {
  it('accepts an explicit global scope for Baz brain provenance', () => {
    expect(memoryNoteActivitySchema.parse({
      projectId: 'project-1',
      noteSlug: 'preferred-workflow',
      scope: 'global',
    })).toEqual({
      projectId: 'project-1',
      noteSlug: 'preferred-workflow',
      scope: 'global',
    })
  })

  it('defaults omitted scope to the current project and rejects unknown scopes', () => {
    expect(memoryNoteActivitySchema.parse({
      projectId: 'project-1',
      noteSlug: 'architecture',
    }).scope).toBe('project')

    expect(() => memoryNoteActivitySchema.parse({
      projectId: 'project-1',
      noteSlug: 'architecture',
      scope: 'everywhere',
    })).toThrow()
  })
})
