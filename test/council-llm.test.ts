import { describe, expect, it } from 'vitest'
import type { SanitizedDiff } from '../shared/diff-sanitize'
import {
  COUNCIL_ADVISORS,
  COUNCIL_ADVISOR_IDS,
  anonymize,
  buildAdvisorPrompt,
  buildChairmanPrompt,
  buildPeerPrompt,
  type CouncilAdvisorOutput,
} from '../shared/council'

const sanitized: SanitizedDiff = {
  files: [{ path: 'src/pay.ts', content: '+const total = price * qty', truncated: false, untracked: false }],
  blockedFiles: [],
  summarizedFiles: [],
  injectionSuspects: [],
  totalChars: 26,
  truncatedTotal: false,
}

const advisorOutputs = (): CouncilAdvisorOutput[] =>
  COUNCIL_ADVISORS.map((a, i) => ({ id: a.id, label: a.label, text: `point from ${a.label} #${i}`, ok: true }))

describe('council roster', () => {
  it('ships exactly the five Karpathy advisors', () => {
    expect(COUNCIL_ADVISORS).toHaveLength(5)
    expect(COUNCIL_ADVISOR_IDS).toEqual([
      'contrarian',
      'first-principles',
      'expansionist',
      'outsider',
      'executor',
    ])
  })
})

describe('buildAdvisorPrompt', () => {
  it("carries the advisor's lens, the author's intent, and the fenced diff", () => {
    const advisor = COUNCIL_ADVISORS[0]
    const prompt = buildAdvisorPrompt(advisor, {
      sanitized,
      fenceTag: '==FENCE==',
      question: 'add tax to the total',
      projectName: 'cockpiT',
    })
    expect(prompt).toContain(advisor.prompt)
    expect(prompt).toContain('add tax to the total')
    expect(prompt).toContain('cockpiT')
    // The tag names the rule once, then opens and closes the untrusted block.
    expect(prompt.match(/==FENCE==/g)).toHaveLength(3)
    expect(prompt).toContain('+const total = price * qty')
    expect(prompt).toContain('UNTRUSTED DATA')
  })

  it('omits the intent line when no question is supplied', () => {
    const prompt = buildAdvisorPrompt(COUNCIL_ADVISORS[0], {
      sanitized,
      fenceTag: '==F==',
      question: null,
      projectName: 'x',
    })
    expect(prompt).not.toContain('The author describes the task as')
  })
})

describe('buildPeerPrompt', () => {
  it('poses the three peer-review questions over the lettered responses', () => {
    const prompt = buildPeerPrompt([
      { letter: 'A', text: 'alpha take' },
      { letter: 'B', text: 'beta take' },
    ])
    expect(prompt).toContain('STRONGEST')
    expect(prompt).toContain('BIGGEST BLIND SPOT')
    expect(prompt).toContain('COLLECTIVE GAP')
    expect(prompt).toContain('### Response A')
    expect(prompt).toContain('alpha take')
    expect(prompt).toContain('### Response B')
  })
})

describe('buildChairmanPrompt', () => {
  it('includes only successful advisors, the peer review, and the verdict sections', () => {
    const advisors = advisorOutputs()
    advisors[2] = { ...advisors[2], ok: false, text: 'unreachable' }
    const prompt = buildChairmanPrompt({ question: 'q', advisors, peerReview: 'the peer said things' })
    expect(prompt).toContain('### Contrarian')
    expect(prompt).not.toContain('unreachable') // failed advisor is dropped
    expect(prompt).toContain('the peer said things')
    expect(prompt).toContain('### 🎯 Verdict')
    expect(prompt).toContain('### ➡️ Next step')
  })
})

describe('anonymize', () => {
  it('applies the permutation and labels responses A, B, C…', () => {
    const advisors = advisorOutputs()
    const shuffled = anonymize(advisors, [4, 0, 2, 1, 3])
    expect(shuffled.map((r) => r.letter)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(shuffled[0].text).toBe(advisors[4].text)
    expect(shuffled[1].text).toBe(advisors[0].text)
  })

  it('only anonymizes advisors that responded', () => {
    const advisors = advisorOutputs()
    advisors[1] = { ...advisors[1], ok: false }
    const shuffled = anonymize(advisors, [0, 1, 2, 3])
    expect(shuffled).toHaveLength(4)
    expect(shuffled.every((r) => r.text !== advisors[1].text)).toBe(true)
  })
})
