import { describe, expect, it } from 'vitest'
import { detectMemoryEvidence } from '../shared/memory-evidence'

describe('detectMemoryEvidence', () => {
  it('reads a compliant opening status line with note files', () => {
    const evidence = detectMemoryEvidence(
      'MEMORY: read swarm-design.md, memory-hub.md\n\nHere is the plan…',
    )
    expect(evidence.status).toBe('read')
    expect(evidence.files).toEqual(['swarm-design.md', 'memory-hub.md'])
  })

  it('accepts the explicit no-relevant-notes form', () => {
    const evidence = detectMemoryEvidence('MEMORY: no relevant notes\nAnswer follows.')
    expect(evidence.status).toBe('none')
    expect(evidence.files).toEqual([])
  })

  it('finds the status line within the first few lines, not only line one', () => {
    const evidence = detectMemoryEvidence('Sure.\nMEMORY: read a.md\nWork…')
    expect(evidence.status).toBe('read')
    expect(evidence.files).toEqual(['a.md'])
  })

  it('reports missing when a reply skips the contract line entirely', () => {
    const evidence = detectMemoryEvidence('Here is a long answer with no status line at all.')
    expect(evidence.status).toBe('missing')
    expect(evidence.files).toEqual([])
  })

  it('treats a malformed MEMORY line as missing evidence, never as compliance', () => {
    const evidence = detectMemoryEvidence('MEMORY: probably fine\n…')
    expect(evidence.status).toBe('missing')
  })
})
