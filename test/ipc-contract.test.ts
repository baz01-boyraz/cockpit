/**
 * IPC contract parity test (VISION Phase 2.1).
 *
 * Three of the four contract participants are compile-bound to `CockpitApi`
 * (`const api: CockpitApi` in preload, `createMockApi(): CockpitApi` in the
 * mock, and the renderer as its consumer) — tsc guarantees their METHOD
 * surface. What the compiler cannot see is string-channel WIRING:
 *   - a channel with no main-process handler fails only at runtime in Electron
 *     ("No handler registered"), while the browser mock keeps working;
 *   - a preload method could invoke the wrong channel constant;
 *   - a push event could be forwarded by main but never subscribable.
 * This test closes those legs by scanning the two wiring files. The handler
 * return TYPES are enforced separately by `IpcResultMap` (see shared/ipc.ts).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { IPC } from '@shared/ipc'

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

const keys = Object.keys(IPC) as (keyof typeof IPC)[]
const requestKeys = keys.filter((k) => !k.startsWith('evt'))
const eventKeys = keys.filter((k) => k.startsWith('evt'))

describe('IPC contract parity', () => {
  const mainSrc = read('electron/main/ipc/registerIpc.ts')
  const preloadSrc = read('electron/preload/index.ts')

  it('covers a sane number of channels (guards the scan itself)', () => {
    expect(requestKeys.length).toBeGreaterThan(40)
    expect(eventKeys.length).toBeGreaterThanOrEqual(5)
  })

  it('every request/response channel has a main-process handler', () => {
    const missing = requestKeys.filter((k) => !mainSrc.includes(`handle('${k}'`))
    expect(missing, `add handle('${missing[0]}', …) to registerIpc.ts`).toEqual([])
  })

  it('main registers no unknown channels', () => {
    const registered = [...mainSrc.matchAll(/handle\('(\w+)'/g)].map((m) => m[1])
    const unknown = registered.filter((k) => !requestKeys.includes(k as keyof typeof IPC))
    expect(unknown).toEqual([])
    // No duplicate registrations either.
    expect(new Set(registered).size).toBe(registered.length)
  })

  it('every request/response channel is invoked from the preload bridge', () => {
    const missing = requestKeys.filter((k) => !new RegExp(`invoke\\(IPC\\.${k}\\b`).test(preloadSrc))
    expect(missing, `add an invoke(IPC.${missing[0]}, …) call to preload`).toEqual([])
  })

  it('every push event has a preload subscription', () => {
    const missing = eventKeys.filter((k) => !new RegExp(`subscribe\\(IPC\\.${k}\\b`).test(preloadSrc))
    expect(missing, `add a subscribe(IPC.${missing[0]}, …) method to preload`).toEqual([])
  })
})
