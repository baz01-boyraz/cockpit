import { describe, expect, it } from 'vitest'
import type { MemoryCaptureNotice } from '@shared/memory-capture'
import { memoryCaptureNoticeKey, memoryCaptureNoticeView } from './memoryCaptureNotice'

const notice = (over: Partial<MemoryCaptureNotice> = {}): MemoryCaptureNotice => ({
  id: 'notice-1',
  projectId: 'project-1',
  provider: 'claude',
  sourceSessionId: 'claude-session-1',
  outcome: 'created',
  scope: 'project',
  slug: 'package-manager',
  title: 'Package manager',
  summary: 'This project uses pnpm for installs and scripts.',
  reason: 'Needed whenever dependencies or build scripts change.',
  at: '2026-07-13T18:02:00.000Z',
  ...over,
})

describe('live Memory capture notices', () => {
  it('explains that the provider supplied the fact and Cockpit performed the save', () => {
    expect(memoryCaptureNoticeView(notice())).toEqual({
      tone: 'saved',
      eyebrow: 'Memory saved · Claude → Cockpit',
      title: 'Package manager',
      summary: 'This project uses pnpm for installs and scripts.',
      detail: 'Project · Needed whenever dependencies or build scripts change.',
      persistent: false,
    })
  })

  it('keeps the rare serious review visible and labels it honestly', () => {
    expect(memoryCaptureNoticeView(notice({ provider: 'codex', outcome: 'review', scope: 'global' }))).toMatchObject({
      tone: 'review',
      eyebrow: 'Memory needs a decision · Codex → Cockpit',
      detail: 'Global · Needed whenever dependencies or build scripts change.',
      persistent: true,
    })
  })

  it('coalesces repeated notices for the same fact instead of stacking duplicates', () => {
    expect(memoryCaptureNoticeKey(notice({ id: 'first' }))).toBe(
      memoryCaptureNoticeKey(notice({ id: 'second' })),
    )
    expect(memoryCaptureNoticeKey(notice({ slug: 'another-fact' }))).not.toBe(
      memoryCaptureNoticeKey(notice()),
    )
  })
})
