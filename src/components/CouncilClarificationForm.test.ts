import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { CouncilClarification } from '@shared/council'
import { CouncilClarificationForm } from './CouncilClarificationForm'

const questions: CouncilClarification[] = [
  {
    id: 'scope',
    question: 'Yalnızca rapor mu, yoksa kod değişikliği de mi?',
    why: 'Teslimat sınırını belirler.',
    recommendedAnswer: 'Önce rapor hazırlansın.',
  },
  {
    id: 'surface',
    question: 'Tüm Council yolculuğu mu incelensin?',
    why: 'Test kapsamını belirler.',
    recommendedAnswer: 'Tüm yolculuk incelensin.',
  },
  {
    id: 'depth',
    question: 'Ne kadar ayrıntı gerekli?',
    why: 'Rapor uzunluğunu belirler.',
    recommendedAnswer: 'Karar vermeye yetecek kadar.',
  },
]

describe('CouncilClarificationForm compact answer flow', () => {
  it('shows one focused question at a time instead of three full-height cards', () => {
    const html = renderToStaticMarkup(
      createElement(CouncilClarificationForm, {
        questions,
        continuing: false,
        responseLanguage: 'tr',
        onContinue: vi.fn(),
      }),
    )

    expect(html).toContain('Soru 1 / 3')
    expect(html).toContain(questions[0].question)
    expect(html).not.toContain(questions[1].question)
    expect(html).not.toContain(questions[2].question)
    expect(html).toContain('Önerilen cevabı kullan')
    expect(html).toContain('Kendi cevabımı yaz')
  })
})
