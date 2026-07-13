import { describe, expect, it } from 'vitest'
import { COUNCIL_SEATS } from '../shared/council'
import {
  buildAnalysisSeatPrompt,
  buildSeatPrompt,
} from '../shared/council-prompts'
import { directAgentContractText } from '../shared/direct-agent-contract'
import { buildWorkerPrompt } from '../shared/swarm-worker'
import { councilContractText } from '../shared/council-contract'
import { swarmWorkerContractText } from '../shared/swarm-worker-contract'

describe('runtime contract isolation', () => {
  it('keeps the direct terminal contract provider-neutral and worker-free', () => {
    const text = directAgentContractText()
    expect(text).toContain('COCKPIT DIRECT AGENT CONTRACT')
    expect(text).not.toContain('COCKPIT SWARM WORKER CONTRACT')
    expect(text).not.toContain('COCKPIT COUNCIL CONTRACT')
    expect(text).not.toMatch(/projectId|COCKPIT_PROJECT_ID|create_swarm_card|quota/i)
  })

  it('injects only the Swarm worker contract into worker prompts', () => {
    const text = buildWorkerPrompt({ title: 'Fix it', body: 'Stay scoped.' }, [])
    expect(text).toContain(swarmWorkerContractText())
    expect(text).not.toContain('COCKPIT DIRECT AGENT CONTRACT')
    expect(text).not.toContain('COCKPIT COUNCIL CONTRACT')
  })

  it('injects only the Council contract into spec/diff and analysis seats', () => {
    const seat = COUNCIL_SEATS[0]
    const spec = buildSeatPrompt(seat, {
      mode: 'spec',
      fenceTag: 'FENCE',
      projectName: 'cockpit',
      question: 'Review this spec',
      specText: 'Goal: safe behavior.',
    })
    const analysis = buildAnalysisSeatPrompt(seat, {
      question: 'Analyze architecture',
      fenceTag: 'FENCE',
      evidencePack: {
        schemaVersion: 1,
        repository: {
          workspaceHash: 'a'.repeat(64),
          manifestHash: 'b'.repeat(64),
          headRef: null,
          filesVisited: 0,
          filesRead: 0,
          canonicalMemoryMdPresent: false,
        },
        sources: [],
        unknowns: [],
        totalChars: 0,
        truncated: false,
      },
    })
    for (const text of [spec, analysis]) {
      expect(text).toContain(councilContractText())
      expect(text).not.toContain('COCKPIT DIRECT AGENT CONTRACT')
      expect(text).not.toContain('COCKPIT SWARM WORKER CONTRACT')
    }
  })

  it('contracts do not embed one another', () => {
    expect(swarmWorkerContractText()).not.toContain('COCKPIT DIRECT AGENT CONTRACT')
    expect(swarmWorkerContractText()).not.toContain('COCKPIT COUNCIL CONTRACT')
    expect(councilContractText()).not.toContain('COCKPIT DIRECT AGENT CONTRACT')
    expect(councilContractText()).not.toContain('COCKPIT SWARM WORKER CONTRACT')
  })
})
