import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AgentUsageService,
  usageProbeDiagnostic,
} from '../electron/main/services/AgentUsageService'

describe('AgentUsageService diagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('logs a redacted provider diagnostic while returning an honest telemetry-unavailable state', async () => {
    const onProbeError = vi.fn()
    const fetchImpl = vi.fn(async () => {
      throw new Error('HTTP 503 while using sk-ant-oat-secret-example-value')
    })
    const service = new AgentUsageService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveClaudeCreds: async () => ({
        token: 'sk-ant-oat-test-token',
        expiresAt: Date.now() + 60_000,
        plan: 'max',
      }),
      readCodexAuth: async () => null,
      onProbeError,
    })

    const report = await service.getReport()
    const claude = report.providers.find((provider) => provider.provider === 'claude')

    expect(claude).toMatchObject({
      available: false,
      reason: 'Usage temporarily unavailable.',
    })
    expect(onProbeError).toHaveBeenCalledWith(
      'claude',
      expect.stringContaining('HTTP 503'),
    )
    expect(onProbeError.mock.calls[0][1]).not.toContain('sk-ant-oat-secret-example-value')
  })

  it('classifies status codes and timeouts without exposing arbitrary error payloads', () => {
    expect(usageProbeDiagnostic(new Error('HTTP 403'))).toBe('HTTP 403')
    expect(usageProbeDiagnostic(new Error('This operation was aborted'))).toBe('request aborted')
    expect(
      usageProbeDiagnostic(new Error('Bearer sk-ant-oat-secret-example-value failed')),
    ).not.toContain('sk-ant-oat-secret-example-value')
  })

  it('does not probe Anthropic with an already-expired Claude credential', async () => {
    const fetchImpl = vi.fn()
    const onProbeError = vi.fn()
    const service = new AgentUsageService({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolveClaudeCreds: async () => ({
        token: 'sk-ant-oat-expired-test-token',
        expiresAt: Date.now() - 60_000,
        plan: 'max',
      }),
      readCodexAuth: async () => null,
      onProbeError,
    })

    const report = await service.getReport()
    const claude = report.providers.find((provider) => provider.provider === 'claude')

    expect(claude).toMatchObject({
      available: false,
      reason: 'Session expired — reopen Claude Code to refresh.',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(onProbeError).not.toHaveBeenCalled()
  })
})
