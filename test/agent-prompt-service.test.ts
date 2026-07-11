import { describe, expect, it, vi } from 'vitest'
import { AgentPromptService } from '../electron/main/services/AgentPromptService'

const readyContext = {
  block: [
    'COCKPIT PROJECT MEMORY — search .cockpit-memory/ and read only task-relevant notes.',
  ].join('\n'),
  receipt: {
    contextId: 'memctx_terminal',
    surface: 'terminal_codex' as const,
    status: 'ready' as const,
    delivery: 'lookup' as const,
    notes: [],
    characters: 88,
  },
}

describe('AgentPromptService', () => {
  it('routes a Codex terminal task through project memory before submission', () => {
    const terminals = {
      get: vi.fn(() => ({ id: 'term_1', projectId: 'prj_1', role: 'codex' as const })),
    }
    const memory = { forTask: vi.fn(() => readyContext) }
    const service = new AgentPromptService(terminals, memory)

    const result = service.prepare('term_1', 'Redesign the landing page')

    expect(memory.forTask).toHaveBeenCalledWith({
      projectId: 'prj_1',
      surface: 'terminal_codex',
      query: 'Redesign the landing page',
    })
    expect(result.prompt).toContain('search .cockpit-memory/')
    expect(result.prompt).toContain('Redesign the landing page')
    expect(result.prompt).not.toContain('Use copper accents.')
    expect(result.prompt.length).toBeLessThan(400)
    expect(result.memory.contextId).toBe('memctx_terminal')
  })

  it('rejects ordinary shell panes because they are not agent task surfaces', () => {
    const terminals = {
      get: vi.fn(() => ({ id: 'term_2', projectId: 'prj_1', role: 'general' as const })),
    }
    const service = new AgentPromptService(terminals, { forTask: vi.fn() })

    expect(() => service.prepare('term_2', 'npm test')).toThrow(/Claude or Codex/i)
  })
})
