import { describe, expect, it, vi } from 'vitest'
import {
  HERMES_TRIAGE_MODEL,
  HermesTriageService,
  type HermesTriageRunner,
} from '../electron/main/services/hermes/HermesTriageService'
import { buildSignal, type SentinelSignal } from '../shared/sentinel'

const signal = (over: Partial<Parameters<typeof buildSignal>[0]> = {}): SentinelSignal =>
  buildSignal({
    id: 'sig_1',
    projectId: 'p1',
    severity: 'notice',
    source: 'log-intelligence',
    title: 'Build failed',
    summary: 'a stale build dropped the alias',
    context: "Error: Cannot find module '@shared/x'",
    createdAt: '2026-07-08T00:00:00.000Z',
    ...over,
  })

/** A promise plus its resolver, so a test can hold a runner call open. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('HermesTriageService', () => {
  const NOW = '2026-07-08T09:00:00.000Z'

  it('passes the DeepSeek model + oneshot argv and returns a parsed verdict', async () => {
    const runner: HermesTriageRunner = vi.fn(async () => ({
      stdout:
        '{"reportWorthy": true, "headline": "Build broke", "action": "Rebuild", "gotchaCandidate": false}',
    }))
    const svc = new HermesTriageService(runner, () => NOW)

    const verdict = await svc.triage(signal())

    expect(verdict).toEqual({
      reportWorthy: true,
      headline: 'Build broke',
      action: 'Rebuild',
      gotchaCandidate: false,
      at: NOW,
    })
    const call = (runner as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    const args = call[1] as string[]
    expect(args).toContain('--ignore-rules')
    expect(args).toContain('-m')
    expect(args).toContain(HERMES_TRIAGE_MODEL)
    expect(args).toContain('--oneshot')
    // The prompt is the discrete argv entry right after --oneshot (execFile, no shell).
    const promptIdx = args.indexOf('--oneshot') + 1
    expect(args[promptIdx]).toContain('UNTRUSTED DATA')
  })

  it('returns null when the runner rejects (timeout / spawn failure) — no throw, no retry', async () => {
    const runner: HermesTriageRunner = vi.fn(async () => {
      const err = Object.assign(new Error('Command failed'), { killed: true })
      throw err
    })
    const svc = new HermesTriageService(runner, () => NOW)

    await expect(svc.triage(signal())).resolves.toBeNull()
    expect(runner).toHaveBeenCalledTimes(1) // no retry
  })

  it('returns null when the model output is unparseable garbage', async () => {
    const runner: HermesTriageRunner = vi.fn(async () => ({ stdout: 'I could not decide, sorry.' }))
    const svc = new HermesTriageService(runner, () => NOW)

    await expect(svc.triage(signal())).resolves.toBeNull()
  })

  it('caps concurrency at 2 — a third overlapping triage skips (null) without spawning', async () => {
    const gate1 = deferred<{ stdout: string }>()
    const gate2 = deferred<{ stdout: string }>()
    const gates = [gate1, gate2]
    const runner: HermesTriageRunner = vi.fn(() => {
      const g = gates.shift()
      if (!g) throw new Error('runner should not be called a 3rd time while 2 are in flight')
      return g.promise
    })
    const svc = new HermesTriageService(runner, () => NOW)

    const p1 = svc.triage(signal({ id: 'a' }))
    const p2 = svc.triage(signal({ id: 'b' }))
    // Two are now in flight (both awaiting their gates); the third must skip.
    const third = await svc.triage(signal({ id: 'c' }))
    expect(third).toBeNull()
    expect(runner).toHaveBeenCalledTimes(2)

    // Release the two in-flight calls; both parse cleanly.
    const ok = '{"reportWorthy": true, "headline": "h", "action": "a", "gotchaCandidate": false}'
    gate1.resolve({ stdout: ok })
    gate2.resolve({ stdout: ok })
    expect((await p1)?.headline).toBe('h')
    expect((await p2)?.headline).toBe('h')

    // With the two settled, the slots are freed — a later triage runs again.
    ;(runner as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({ stdout: ok }))
    expect((await svc.triage(signal({ id: 'd' })))?.headline).toBe('h')
  })
})
