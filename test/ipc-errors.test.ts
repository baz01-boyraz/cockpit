import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { formatIpcError } from '@shared/ipc-errors'
import { gitPushInputSchema } from '@shared/schemas'

describe('formatIpcError', () => {
  it('turns a ZodError into a single readable line', () => {
    const err = z.object({ name: z.string() }).safeParse({}).error
    const out = formatIpcError(err)
    expect(out).toMatch(/^Invalid request: /)
    expect(out).not.toContain('{')
    expect(out).not.toContain('"code"')
  })

  it('surfaces the force-push refine message cleanly', () => {
    const err = gitPushInputSchema.safeParse({ projectId: 'p', force: true }).error
    expect(formatIpcError(err)).toBe(
      'Invalid request: Force-push requires an approved request — request approval first.',
    )
  })

  it('replaces the home directory with ~ in plain errors', () => {
    const err = new Error('ENOENT: no such file /Users/baz/secret-project/config.json')
    expect(formatIpcError(err, '/Users/baz')).toBe(
      'ENOENT: no such file ~/secret-project/config.json',
    )
  })

  it('stringifies non-Error throwables', () => {
    expect(formatIpcError('plain failure')).toBe('plain failure')
  })
})
