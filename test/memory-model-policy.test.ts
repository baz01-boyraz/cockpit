import { describe, expect, it, vi } from 'vitest'
import {
  MEMORY_ANALYSIS_ENGINE,
  MEMORY_ANALYSIS_FALLBACKS,
  runMemoryAnalysis,
} from '@shared/memory-model-policy'
import type { EngineSpec } from '@shared/engines'

describe('memory analysis engine chain', () => {
  it('keeps OpenRouter Flash primary and orders local CLIs by cost: codex (subscription) before claude (coding quota)', () => {
    expect(MEMORY_ANALYSIS_ENGINE.engine).toBe('openrouter')
    expect(MEMORY_ANALYSIS_FALLBACKS.map((s) => s.engine)).toEqual(['codex', 'claude'])
  })

  it('returns the primary result without touching fallbacks', async () => {
    const call = vi.fn(async (spec: EngineSpec) => `via ${spec.engine}`)
    await expect(runMemoryAnalysis(call)).resolves.toBe('via openrouter')
    expect(call).toHaveBeenCalledTimes(1)
  })

  it('falls back to the codex CLI when OpenRouter fails, and notifies the observer', async () => {
    const call = vi.fn(async (spec: EngineSpec) => {
      if (spec.engine === 'openrouter') throw new Error('Add an OpenRouter key in Settings to run this engine.')
      return `via ${spec.engine}`
    })
    const onFallback = vi.fn()
    await expect(runMemoryAnalysis(call, onFallback)).resolves.toBe('via codex')
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(onFallback.mock.calls[0][0]).toMatchObject({
      failed: { engine: 'openrouter' },
      next: { engine: 'codex' },
    })
  })

  it('reaches the claude CLI when both cheaper engines fail', async () => {
    const call = vi.fn(async (spec: EngineSpec) => {
      if (spec.engine !== 'claude') throw new Error(`${spec.engine} down`)
      return 'via claude'
    })
    await expect(runMemoryAnalysis(call)).resolves.toBe('via claude')
    expect(call).toHaveBeenCalledTimes(3)
  })

  it('throws the last failure when every engine in the chain fails', async () => {
    const call = vi.fn(async (spec: EngineSpec) => {
      throw new Error(`${spec.engine} down`)
    })
    await expect(runMemoryAnalysis(call)).rejects.toThrow('claude down')
  })

  it('a throwing observer never breaks the chain', async () => {
    const call = vi.fn(async (spec: EngineSpec) => {
      if (spec.engine === 'openrouter') throw new Error('down')
      return `via ${spec.engine}`
    })
    const onFallback = vi.fn(() => {
      throw new Error('observer exploded')
    })
    await expect(runMemoryAnalysis(call, onFallback)).resolves.toBe('via codex')
  })
})
