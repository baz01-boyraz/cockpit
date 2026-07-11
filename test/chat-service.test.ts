import { describe, expect, it, vi } from 'vitest'
import { ChatService, type ChatRunner } from '../electron/main/services/ChatService'
import type { ProjectService } from '../electron/main/services/ProjectService'

const BLOCK = 'COCKPIT MEMORY CONTRACT (MUST) — search .cockpit-memory/ and read task-relevant notes.'

function makeService(stdout: string) {
  const projects = {
    get: vi.fn(() => ({ id: 'prj_1', name: 'cockpiT', path: '/tmp/prj' })),
  } as unknown as ProjectService
  const memory = {
    forTask: vi.fn(() => ({
      block: BLOCK,
      receipt: {
        contextId: 'memctx_chat',
        surface: 'claude_chat' as const,
        status: 'ready' as const,
        delivery: 'lookup' as const,
        notes: [],
        characters: BLOCK.length,
      },
    })),
  }
  const runner = vi.fn(async () => ({ stdout })) as unknown as ChatRunner
  const audit = { record: vi.fn() }
  return { service: new ChatService(projects, memory, runner, audit), memory, runner, audit }
}

describe('ChatService memory foundation', () => {
  it('sends the user prompt verbatim and rides the contract on the system channel', async () => {
    const { service, memory, runner } = makeService('MEMORY: read swarm-design.md\nPlan…')

    const reply = await service.ask('prj_1', 'Redesign the landing page')

    const args = vi.mocked(runner).mock.calls[0][1]
    // The user's words are the positional prompt, byte-for-byte — the contract
    // must never be glued on top of them.
    expect(args.at(-1)).toBe('Redesign the landing page')
    const flagAt = args.indexOf('--append-system-prompt')
    expect(flagAt).toBeGreaterThanOrEqual(0)
    expect(args[flagAt + 1]).toBe(BLOCK)
    expect(memory.forTask).toHaveBeenCalledWith({
      projectId: 'prj_1',
      surface: 'claude_chat',
      query: 'Redesign the landing page',
    })
    expect(reply.memoryContext?.contextId).toBe('memctx_chat')
  })

  it('attaches compliance evidence from the reply status line to the receipt', async () => {
    const { service } = makeService('MEMORY: read swarm-design.md\nPlan…')
    const reply = await service.ask('prj_1', 'Redesign the landing page')
    expect(reply.memoryContext?.evidence).toEqual({
      status: 'read',
      files: ['swarm-design.md'],
    })
  })

  it('marks a reply that ignored the contract as missing evidence and audits the violation', async () => {
    const { service, audit } = makeService('Just an answer, no status line.')
    const reply = await service.ask('prj_1', 'Redesign the landing page')
    expect(reply.memoryContext?.evidence?.status).toBe('missing')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'memory.compliance_missing' }),
    )
  })

  it('does not audit a compliant reply', async () => {
    const { service, audit } = makeService('MEMORY: read a.md\nPlan…')
    await service.ask('prj_1', 'Redesign the landing page')
    expect(audit.record).not.toHaveBeenCalled()
  })
})
