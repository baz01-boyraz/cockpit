import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildTranscriptPrompt,
  capHistory,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_TURNS,
  type ChatTurn,
} from '@shared/hermes-chat'
import { buildHermesArgs } from '@shared/hermes-run'
import { hermesChatAskSchema, hermesChatClearSchema } from '@shared/schemas'
import {
  HermesChatService,
  type HermesChatRunner,
} from '../electron/main/services/hermes/HermesChatService'
import type { ProjectService } from '../electron/main/services/ProjectService'

// --------------------------------------------------------------------------
// Pure history helpers
// --------------------------------------------------------------------------

const turn = (role: ChatTurn['role'], content: string): ChatTurn => ({ role, content })

describe('capHistory', () => {
  it('returns the history unchanged when within both caps', () => {
    const turns = [turn('user', 'hi'), turn('assistant', 'hello')]
    expect(capHistory(turns)).toEqual(turns)
  })

  it('drops the oldest turns past the turn-count cap', () => {
    const turns = Array.from({ length: MAX_HISTORY_TURNS + 5 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', `m${i}`),
    )
    const capped = capHistory(turns)
    expect(capped).toHaveLength(MAX_HISTORY_TURNS)
    // The newest turn survives, the oldest is gone.
    expect(capped.at(-1)).toEqual(turns.at(-1))
    expect(capped[0]).toEqual(turns[5])
  })

  it('drops the oldest turns past the char budget', () => {
    const big = 'x'.repeat(MAX_HISTORY_CHARS)
    const turns = [turn('user', big), turn('assistant', big), turn('user', 'newest')]
    const capped = capHistory(turns)
    // Only the newest fits once the two big ones blow the budget.
    expect(capped).toEqual([turn('user', 'newest')])
  })

  it('always keeps the most recent turn even if it alone exceeds the char cap', () => {
    const huge = 'y'.repeat(MAX_HISTORY_CHARS + 1)
    const capped = capHistory([turn('user', huge)])
    expect(capped).toEqual([turn('user', huge)])
  })

  it('does not mutate its input', () => {
    const turns = Array.from({ length: MAX_HISTORY_TURNS + 2 }, (_, i) => turn('user', `m${i}`))
    const snapshot = [...turns]
    capHistory(turns)
    expect(turns).toEqual(snapshot)
  })
})

describe('buildTranscriptPrompt', () => {
  it('labels each turn and prefixes an instruction', () => {
    const prompt = buildTranscriptPrompt([turn('user', 'ping'), turn('assistant', 'pong')])
    expect(prompt).toContain('User: ping')
    expect(prompt).toContain('Hermes: pong')
    expect(prompt.startsWith('You are Hermes')).toBe(true)
  })
})

// --------------------------------------------------------------------------
// Schema validation
// --------------------------------------------------------------------------

describe('hermesChat schemas', () => {
  it('accepts a valid ask payload', () => {
    expect(hermesChatAskSchema.parse({ projectId: 'prj_1', message: 'hey' })).toEqual({
      projectId: 'prj_1',
      message: 'hey',
    })
  })

  it('rejects an empty message', () => {
    expect(hermesChatAskSchema.safeParse({ projectId: 'prj_1', message: '' }).success).toBe(false)
  })

  it('rejects a message over 8000 chars', () => {
    const message = 'a'.repeat(8001)
    expect(hermesChatAskSchema.safeParse({ projectId: 'prj_1', message }).success).toBe(false)
  })

  it('rejects a missing projectId', () => {
    expect(hermesChatAskSchema.safeParse({ message: 'hey' }).success).toBe(false)
  })

  it('accepts an optional imagePath', () => {
    expect(
      hermesChatAskSchema.parse({ projectId: 'prj_1', message: 'hey', imagePath: '/tmp/a.png' }),
    ).toEqual({ projectId: 'prj_1', message: 'hey', imagePath: '/tmp/a.png' })
  })

  it('rejects an empty imagePath', () => {
    expect(
      hermesChatAskSchema.safeParse({ projectId: 'prj_1', message: 'hey', imagePath: '' }).success,
    ).toBe(false)
  })

  it('validates the clear payload', () => {
    expect(hermesChatClearSchema.parse({ projectId: 'prj_1' })).toEqual({ projectId: 'prj_1' })
    expect(hermesChatClearSchema.safeParse({ projectId: '' }).success).toBe(false)
  })
})

// --------------------------------------------------------------------------
// buildHermesArgs — chat omits --ignore-rules
// --------------------------------------------------------------------------

describe('buildHermesArgs ignoreRules option', () => {
  it('defaults to including --ignore-rules (distiller behaviour)', () => {
    expect(buildHermesArgs('p')).toEqual(['--ignore-rules', '--oneshot', 'p'])
  })

  it('omits --ignore-rules when ignoreRules is false (chat behaviour)', () => {
    expect(buildHermesArgs('p', { ignoreRules: false })).toEqual(['--oneshot', 'p'])
  })

  it('keeps the model flag before --oneshot with rules omitted', () => {
    expect(buildHermesArgs('p', { ignoreRules: false, model: 'm' })).toEqual([
      '-m',
      'm',
      '--oneshot',
      'p',
    ])
  })
})

// --------------------------------------------------------------------------
// buildHermesArgs — imagePath switches to `chat -q` (the only mode with --image)
// --------------------------------------------------------------------------

describe('buildHermesArgs imagePath option', () => {
  it('builds a chat -q argv with --image and -Q, prompt right after -q', () => {
    expect(buildHermesArgs('p', { ignoreRules: false, imagePath: '/tmp/img.png' })).toEqual([
      'chat',
      '-q',
      'p',
      '-Q',
      '--image',
      '/tmp/img.png',
    ])
  })

  it('appends --ignore-rules and -m after --image when requested', () => {
    expect(
      buildHermesArgs('p', { ignoreRules: true, model: 'm', imagePath: '/tmp/img.png' }),
    ).toEqual(['chat', '-q', 'p', '-Q', '--image', '/tmp/img.png', '--ignore-rules', '-m', 'm'])
  })

  it('is unaffected when imagePath is absent (legacy --oneshot path)', () => {
    expect(buildHermesArgs('p', { ignoreRules: false })).toEqual(['--oneshot', 'p'])
  })
})

// --------------------------------------------------------------------------
// HermesChatService
// --------------------------------------------------------------------------

function makeService(runnerImpl?: HermesChatRunner) {
  const projects = {
    get: vi.fn(() => ({ id: 'prj_1', name: 'cockpiT', path: '/tmp/prj' })),
  } as unknown as ProjectService
  const runner = vi.fn(runnerImpl ?? (async () => ({ stdout: 'ok' })))
  return { service: new HermesChatService(projects, runner), runner }
}

describe('HermesChatService.ask', () => {
  it('accumulates user + assistant turns across calls', async () => {
    let n = 0
    const { service } = makeService(async () => ({ stdout: `reply ${++n}` }))
    await service.ask('prj_1', 'first')
    await service.ask('prj_1', 'second')
    expect(service.history('prj_1')).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply 1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'reply 2' },
    ])
  })

  it('re-sends the whole transcript each turn without --ignore-rules', async () => {
    const { service, runner } = makeService(async () => ({ stdout: 'reply' }))
    await service.ask('prj_1', 'first')
    await service.ask('prj_1', 'second')
    const secondArgs = runner.mock.calls[1][1]
    expect(secondArgs).not.toContain('--ignore-rules')
    expect(secondArgs[0]).toBe('--oneshot')
    const prompt = secondArgs[secondArgs.length - 1]
    expect(prompt).toContain('User: first')
    expect(prompt).toContain('Hermes: reply')
    expect(prompt).toContain('User: second')
  })

  it('runs in the active project directory', async () => {
    const { service, runner } = makeService()
    await service.ask('prj_1', 'hi')
    expect(runner.mock.calls[0][0]).toBe('/tmp/prj')
  })

  it('truncates history from the oldest end past the turn cap', async () => {
    const { service } = makeService(async () => ({ stdout: 'r' }))
    for (let i = 0; i < MAX_HISTORY_TURNS; i += 1) {
      await service.ask('prj_1', `m${i}`)
    }
    const history = service.history('prj_1')
    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS)
    // Newest exchange is retained; the very first message is long gone.
    expect(history.at(-2)).toEqual({ role: 'user', content: `m${MAX_HISTORY_TURNS - 1}` })
    expect(history.some((t) => t.content === 'm0')).toBe(false)
  })

  it('does not commit the user turn when the run fails', async () => {
    const { service } = makeService(async () => {
      throw Object.assign(new Error('boom'), { stderr: 'hermes exploded' })
    })
    const reply = await service.ask('prj_1', 'first')
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('hermes exploded')
    expect(service.history('prj_1')).toEqual([])
  })

  it('returns a friendly timeout error instead of leaking the raw argv when execFile kills the child', async () => {
    const { service } = makeService(async () => {
      throw Object.assign(new Error('Command failed: /path/hermes --oneshot <huge transcript>'), {
        killed: true,
        signal: 'SIGTERM',
      })
    })
    const reply = await service.ask('prj_1', 'first')
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/didn't respond/i)
    expect(reply.error).not.toContain('--oneshot')
    expect(service.history('prj_1')).toEqual([])
  })

  it('escalates the message on a second consecutive timeout', async () => {
    const { service } = makeService(async () => {
      throw Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })
    })
    const first = await service.ask('prj_1', 'first')
    const second = await service.ask('prj_1', 'second')
    expect(first.error).toMatch(/one-off/i)
    expect(second.error).toMatch(/2 times in a row/i)
    expect(second.error).toMatch(/agent\.log/)
  })

  it('resets the timeout streak after a successful reply', async () => {
    let calls = 0
    const { service } = makeService(async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('Command failed'), { killed: true })
      if (calls === 3) throw Object.assign(new Error('Command failed'), { killed: true })
      return { stdout: 'ok' }
    })
    const first = await service.ask('prj_1', 'a') // timeout #1
    const second = await service.ask('prj_1', 'b') // succeeds, resets streak
    const third = await service.ask('prj_1', 'c') // timeout #1 again, not escalated
    expect(first.error).toMatch(/one-off/i)
    expect(second.ok).toBe(true)
    expect(third.error).toMatch(/one-off/i)
  })

  it('resets the timeout streak when the conversation is cleared', async () => {
    const { service } = makeService(async () => {
      throw Object.assign(new Error('Command failed'), { killed: true })
    })
    await service.ask('prj_1', 'first')
    service.clear('prj_1')
    const reply = await service.ask('prj_1', 'second')
    expect(reply.error).toMatch(/one-off/i)
  })

  it('returns a friendly not-found error when the hermes binary is missing', async () => {
    const { service } = makeService(async () => {
      throw Object.assign(new Error('spawn hermes ENOENT'), { code: 'ENOENT' })
    })
    const reply = await service.ask('prj_1', 'hi')
    expect(reply.ok).toBe(false)
    expect(reply.error).toMatch(/not found/i)
    expect(reply.text).toBe('')
  })

  it('falls back to a placeholder when Hermes returns empty output', async () => {
    const { service } = makeService(async () => ({ stdout: '   ' }))
    const reply = await service.ask('prj_1', 'hi')
    expect(reply.ok).toBe(true)
    expect(reply.text).toContain('no message')
  })
})

// --------------------------------------------------------------------------
// HermesChatService.ask — image attachments
// --------------------------------------------------------------------------

describe('HermesChatService.ask image attachment', () => {
  const insideAttachments = join('/tmp/prj', '.dev-cockpit', 'attachments', 'shot.png')

  it('forwards a path inside the project attachments dir to --image', async () => {
    const { service, runner } = makeService(async () => ({ stdout: 'reply' }))
    await service.ask('prj_1', 'look at this', insideAttachments)
    const args = runner.mock.calls[0][1]
    expect(args).toContain('--image')
    expect(args[args.indexOf('--image') + 1]).toBe(insideAttachments)
    expect(args[0]).toBe('chat')
  })

  it('notes the attachment in the stored history without inlining any path', async () => {
    const { service } = makeService(async () => ({ stdout: 'reply' }))
    await service.ask('prj_1', 'look at this', insideAttachments)
    expect(service.history('prj_1')[0]).toEqual({
      role: 'user',
      content: 'look at this\n\n[User attached an image]',
    })
  })

  it('drops a path outside the project attachments dir and falls back to --oneshot', async () => {
    const { service, runner } = makeService(async () => ({ stdout: 'reply' }))
    await service.ask('prj_1', 'hi', '/etc/passwd')
    const args = runner.mock.calls[0][1]
    expect(args).not.toContain('--image')
    expect(args[0]).toBe('--oneshot')
    expect(service.history('prj_1')[0]).toEqual({ role: 'user', content: 'hi' })
  })

  it('drops a path that only escapes via a sneaky prefix match', async () => {
    const { service, runner } = makeService(async () => ({ stdout: 'reply' }))
    // '/tmp/prj/.dev-cockpit/attachments-evil/x.png' starts with the dir's
    // string prefix but is a sibling folder, not a descendant.
    await service.ask('prj_1', 'hi', '/tmp/prj/.dev-cockpit/attachments-evil/x.png')
    const args = runner.mock.calls[0][1]
    expect(args).not.toContain('--image')
  })
})

describe('HermesChatService.clear', () => {
  it('resets a project history so the next turn starts fresh', async () => {
    const { service, runner } = makeService(async () => ({ stdout: 'reply' }))
    await service.ask('prj_1', 'first')
    expect(service.history('prj_1')).toHaveLength(2)

    service.clear('prj_1')
    expect(service.history('prj_1')).toEqual([])

    await service.ask('prj_1', 'fresh')
    const lastPrompt = runner.mock.calls[1][1].at(-1) as string
    expect(lastPrompt).toContain('User: fresh')
    expect(lastPrompt).not.toContain('User: first')
  })

  it('keeps histories isolated per project', async () => {
    const { service } = makeService(async () => ({ stdout: 'reply' }))
    await service.ask('prj_a', 'a-msg')
    await service.ask('prj_b', 'b-msg')
    service.clear('prj_a')
    expect(service.history('prj_a')).toEqual([])
    expect(service.history('prj_b')).toHaveLength(2)
  })
})
