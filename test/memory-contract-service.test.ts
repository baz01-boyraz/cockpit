import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryContractService } from '../electron/main/services/MemoryContractService'
import { claudePromptHookCommand, memoryContractText } from '../shared/memory-contract'

let projectPath: string

function service(audit = { record: vi.fn() }) {
  const projects = { get: vi.fn(() => ({ path: projectPath })) }
  return {
    contract: new MemoryContractService(
      projects as unknown as ConstructorParameters<typeof MemoryContractService>[0],
      audit,
    ),
    audit,
  }
}

beforeEach(() => {
  projectPath = mkdtempSync(join(tmpdir(), 'cockpit-contract-'))
})

afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true })
})

describe('MemoryContractService', () => {
  it('provisions the Claude UserPromptSubmit hook before a claude terminal starts', () => {
    const { contract, audit } = service()
    contract.ensureForAgent('prj_1', 'claude')

    const raw = readFileSync(join(projectPath, '.claude', 'settings.local.json'), 'utf8')
    const parsed = JSON.parse(raw)
    expect(parsed.hooks.UserPromptSubmit[0].hooks[0].command).toBe(claudePromptHookCommand())
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'memory.contract_provisioned' }),
    )
  })

  it('provisions the AGENTS.md managed block before a codex terminal starts', () => {
    const { contract } = service()
    contract.ensureForAgent('prj_1', 'codex')

    const raw = readFileSync(join(projectPath, 'AGENTS.md'), 'utf8')
    expect(raw).toContain(memoryContractText())
  })

  it('keeps existing local settings intact while adding the hook', () => {
    mkdirSync(join(projectPath, '.claude'), { recursive: true })
    writeFileSync(
      join(projectPath, '.claude', 'settings.local.json'),
      JSON.stringify({ enableAllProjectMcpServers: true }, null, 2),
      'utf8',
    )
    const { contract } = service()
    contract.ensureForAgent('prj_1', 'claude')

    const parsed = JSON.parse(readFileSync(join(projectPath, '.claude', 'settings.local.json'), 'utf8'))
    expect(parsed.enableAllProjectMcpServers).toBe(true)
    expect(parsed.hooks.UserPromptSubmit).toHaveLength(1)
  })

  it('is idempotent: a second launch writes nothing and audits nothing new', () => {
    const { contract, audit } = service()
    contract.ensureForAgent('prj_1', 'claude')
    contract.ensureForAgent('prj_1', 'codex')
    audit.record.mockClear()

    contract.ensureForAgent('prj_1', 'claude')
    contract.ensureForAgent('prj_1', 'codex')
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('refuses to launch over corrupt local settings instead of clobbering them', () => {
    mkdirSync(join(projectPath, '.claude'), { recursive: true })
    const file = join(projectPath, '.claude', 'settings.local.json')
    writeFileSync(file, '{ broken json', 'utf8')
    const { contract } = service()

    expect(() => contract.ensureForAgent('prj_1', 'claude')).toThrow(/not valid JSON/i)
    expect(readFileSync(file, 'utf8')).toBe('{ broken json')
  })
})
