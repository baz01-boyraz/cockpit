import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_POLICY,
  automationScheduleLabel,
  nextAutomationRun,
  type AutomationSchedule,
} from '../shared/automation'
import { automationCreateSchema } from '../shared/schemas'

describe('automation schedule contract', () => {
  it('keeps the scheduler calm and bounded', () => {
    expect(AUTOMATION_POLICY).toMatchObject({
      tickMs: 60_000,
      staleRunMs: 10 * 60_000,
      maxJobsPerProject: 20,
      maxInstructionChars: 1_000,
      maxResultChars: 1_200,
    })
  })

  it('computes a daily local-time run without exposing a cron expression', () => {
    const from = new Date(2026, 6, 12, 8, 30, 0, 0)
    const schedule: AutomationSchedule = { kind: 'daily', time: '09:00' }
    const next = new Date(nextAutomationRun(schedule, from.toISOString()))

    expect(next.getTime()).toBeGreaterThan(from.getTime())
    expect(next.getHours()).toBe(9)
    expect(next.getMinutes()).toBe(0)
    expect(automationScheduleLabel(schedule)).toBe('Daily at 09:00')
  })

  it('moves an elapsed daily time to tomorrow and intervals from the last anchor', () => {
    const late = new Date(2026, 6, 12, 9, 0, 0, 0)
    const daily = new Date(
      nextAutomationRun({ kind: 'daily', time: '09:00' }, late.toISOString()),
    )
    expect(daily.getDate()).toBe(late.getDate() + 1)

    const interval = nextAutomationRun({ kind: 'interval', minutes: 360 }, late.toISOString())
    expect(Date.parse(interval) - late.getTime()).toBe(6 * 60 * 60_000)
    expect(automationScheduleLabel({ kind: 'interval', minutes: 360 })).toBe('Every 6 hours')
  })

  it('accepts friendly schedules and rejects abusive or noisy jobs at the IPC boundary', () => {
    expect(
      automationCreateSchema.parse({
        projectId: 'p1',
        name: 'Morning product pulse',
        instruction: 'Tell me whether the project needs my attention.',
        schedule: { kind: 'daily', time: '09:00' },
      }),
    ).toMatchObject({ name: 'Morning product pulse' })

    expect(() =>
      automationCreateSchema.parse({
        projectId: 'p1',
        name: 'Too frequent',
        instruction: 'Ping me constantly.',
        schedule: { kind: 'interval', minutes: 1 },
      }),
    ).toThrow()
    expect(() =>
      automationCreateSchema.parse({
        projectId: 'p1',
        name: 'Too long',
        instruction: 'x'.repeat(AUTOMATION_POLICY.maxInstructionChars + 1),
        schedule: { kind: 'interval', minutes: 360 },
      }),
    ).toThrow()
  })
})
