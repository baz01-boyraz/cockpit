import { describe, expect, it, vi } from 'vitest'
import { ChatService, type ChatRunner } from '../electron/main/services/ChatService'
import type { ProjectService } from '../electron/main/services/ProjectService'

describe('ChatService memory foundation', () => {
  it('injects a compact lookup contract without copying note bodies', async () => {
    const projects = {
      get: vi.fn(() => ({ id: 'prj_1', name: 'cockpiT', path: '/tmp/prj' })),
    } as unknown as ProjectService
    const memory = {
      forTask: vi.fn(() => ({
        block: 'COCKPIT MEMORY — search .cockpit-memory/ and read task-relevant notes.',
        receipt: {
          contextId: 'memctx_chat',
          surface: 'claude_chat' as const,
          status: 'ready' as const,
          delivery: 'lookup' as const,
          notes: [],
          characters: 72,
        },
      })),
    }
    const runner = vi.fn(async () => ({ stdout: 'done' })) as unknown as ChatRunner
    const service = new ChatService(projects, memory, runner)

    const reply = await service.ask('prj_1', 'Redesign the landing page')

    const args = vi.mocked(runner).mock.calls[0][1]
    const prompt = args.at(-1) ?? ''
    expect(prompt).toContain('search .cockpit-memory/')
    expect(prompt).not.toContain('Use molten obsidian surfaces.')
    expect(prompt).toContain('Redesign the landing page')
    expect(memory.forTask).toHaveBeenCalledWith({
      projectId: 'prj_1',
      surface: 'claude_chat',
      query: 'Redesign the landing page',
    })
    expect(reply.memoryContext?.contextId).toBe('memctx_chat')
  })
})
