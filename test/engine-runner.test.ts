import { describe, expect, it } from 'vitest'
import { buildClaudeArgs } from '@shared/claude-run'
import { buildCodexArgs, type EngineSpec } from '@shared/engines'
import {
  EngineRunner,
  type CliRunner,
  type EngineCallOpts,
  type HttpFetch,
} from '../electron/main/services/EngineRunner'
import { OPENROUTER_SECRET_REF } from '../electron/main/services/OpenRouterUsageService'
import type { SecretStore } from '../electron/main/services/SecretStore'

const OPTS: EngineCallOpts = { cwd: '/tmp/project', timeout: 1_000, maxBuffer: 1024 }
const SECRET = 'sk-or-super-secret-key'

/** Only `get` is used by EngineRunner; fake exactly that surface. */
function fakeSecrets(key: string | null): SecretStore {
  return {
    get: (ref: string) => (ref === OPENROUTER_SECRET_REF ? key : null),
  } as unknown as SecretStore
}

interface Recorded {
  bin: string
  args: string[]
  opts: EngineCallOpts
}

function recordingCli(stdout: string): { runner: CliRunner; calls: Recorded[] } {
  const calls: Recorded[] = []
  const runner: CliRunner = (bin, args, opts) => {
    calls.push({ bin, args, opts })
    return Promise.resolve({ stdout })
  }
  return { runner, calls }
}

/** A CliRunner that must never fire — HTTP branches don't spawn. */
const forbiddenCli: CliRunner = () => {
  throw new Error('CLI runner must not be invoked for the openrouter branch')
}

function jsonResponse(status: number, body: unknown, ok = status < 400): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

describe('EngineRunner — CLI branches', () => {
  it('runs the claude branch with resolveBin path and claude args, trimmed', async () => {
    const { runner, calls } = recordingCli('  claude reply  ')
    const service = new EngineRunner(fakeSecrets(null), runner)
    const spec: EngineSpec = { engine: 'claude', model: 'opus' }

    const out = await service.call(spec, 'ship it', OPTS)

    expect(out).toBe('claude reply')
    expect(calls).toHaveLength(1)
    expect(calls[0].bin.endsWith('claude')).toBe(true)
    expect(calls[0].args).toEqual(buildClaudeArgs('ship it', { model: 'opus' }))
    expect(calls[0].opts).toEqual(OPTS)
  })

  it('runs the codex branch with resolveBin path and codex args, trimmed', async () => {
    const { runner, calls } = recordingCli('  codex reply  ')
    const service = new EngineRunner(fakeSecrets(null), runner)
    const spec: EngineSpec = { engine: 'codex', model: 'gpt-5-codex' }

    const out = await service.call(spec, 'ship it', OPTS)

    expect(out).toBe('codex reply')
    expect(calls[0].bin.endsWith('codex')).toBe(true)
    expect(calls[0].args).toEqual(buildCodexArgs('ship it', { model: 'gpt-5-codex' }))
  })
})

describe('EngineRunner — openrouter branch', () => {
  const spec: EngineSpec = { engine: 'openrouter', model: 'deepseek/deepseek-chat' }

  it('POSTs the prompt and returns choices[0].message.content, trimmed', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = []
    const fetchImpl: HttpFetch = (url, init) => {
      seen.push({ url: String(url), init })
      return Promise.resolve(
        jsonResponse(200, { choices: [{ message: { content: '  the answer  ' } }] }),
      )
    }
    const service = new EngineRunner(fakeSecrets(SECRET), forbiddenCli, fetchImpl)

    const out = await service.call(spec, 'what is 2+2', OPTS)

    expect(out).toBe('the answer')
    expect(seen[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    const headers = seen[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`)
    const body = JSON.parse(String(seen[0].init?.body)) as {
      model: string
      messages: { role: string; content: string }[]
    }
    expect(body.model).toBe('deepseek/deepseek-chat')
    expect(body.messages).toEqual([{ role: 'user', content: 'what is 2+2' }])
  })

  it('returns a friendly "add a key" error when none is stored', async () => {
    const service = new EngineRunner(fakeSecrets(null), forbiddenCli, () => {
      throw new Error('fetch must not run without a key')
    })
    await expect(service.call(spec, 'hi', OPTS)).rejects.toThrow(/Add an OpenRouter key in Settings/)
  })

  it('maps 401 to an invalid/expired-key message without leaking the key', async () => {
    const fetchImpl: HttpFetch = () => Promise.resolve(jsonResponse(401, {}, false))
    const service = new EngineRunner(fakeSecrets(SECRET), forbiddenCli, fetchImpl)

    let caught: unknown
    try {
      await service.call(spec, 'hi', OPTS)
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    const message = (caught as Error).message
    expect(message).toMatch(/invalid or expired/i)
    expect(message).not.toContain(SECRET)
  })

  it('maps 402 to an out-of-credits message', async () => {
    const fetchImpl: HttpFetch = () => Promise.resolve(jsonResponse(402, {}, false))
    const service = new EngineRunner(fakeSecrets(SECRET), forbiddenCli, fetchImpl)
    await expect(service.call(spec, 'hi', OPTS)).rejects.toThrow(/out of credits/i)
  })

  it('maps an aborted request to a timeout message', async () => {
    const hangingFetch: HttpFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted')))
      })
    const service = new EngineRunner(fakeSecrets(SECRET), forbiddenCli, hangingFetch)

    await expect(service.call(spec, 'hi', { ...OPTS, timeout: 5 })).rejects.toThrow(/timed out/i)
  })

  it('reports a clean error when the body is not valid JSON', async () => {
    const fetchImpl: HttpFetch = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Unexpected token < in JSON')),
      } as unknown as Response)
    const service = new EngineRunner(fakeSecrets(SECRET), forbiddenCli, fetchImpl)

    await expect(service.call(spec, 'hi', OPTS)).rejects.toThrow(/malformed/i)
  })

  it('rejects when the response carries no message content', async () => {
    const fetchImpl: HttpFetch = () => Promise.resolve(jsonResponse(200, { choices: [] }))
    const service = new EngineRunner(fakeSecrets(SECRET), forbiddenCli, fetchImpl)
    await expect(service.call(spec, 'hi', OPTS)).rejects.toThrow(/no message content/i)
  })
})
