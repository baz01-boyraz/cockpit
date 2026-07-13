import { describe, expect, it } from 'vitest'
import { memoryCaptureSchema } from '@shared/schemas'

describe('memoryCaptureSchema', () => {
  it('requires explicit Claude or Codex provenance for manual capture', () => {
    expect(
      memoryCaptureSchema.parse({ projectId: 'p1', provider: 'codex', sessionId: 's1' }),
    ).toEqual({ projectId: 'p1', provider: 'codex', sessionId: 's1' })
    expect(
      memoryCaptureSchema.safeParse({ projectId: 'p1', sessionId: 's1' }).success,
    ).toBe(false)
    expect(
      memoryCaptureSchema.safeParse({ projectId: 'p1', provider: 'other', sessionId: 's1' }).success,
    ).toBe(false)
  })
})
