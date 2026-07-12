import { useEffect, useMemo, useState } from 'react'
import type { CouncilClarification, CouncilClarificationAnswer } from '@shared/council'
import { IconCheck } from './icons'

interface CouncilClarificationFormProps {
  questions: readonly CouncilClarification[]
  continuing: boolean
  responseLanguage?: string
  onContinue: (answers: CouncilClarificationAnswer[]) => void
}

/** One focused decision at a time. The previous stacked-card layout made three
 * short questions feel like a form marathon and pushed the submit action far
 * below the fold. Recommendations remain opt-in author choices. */
export function CouncilClarificationForm({
  questions,
  continuing,
  responseLanguage = 'en',
  onContinue,
}: CouncilClarificationFormProps) {
  const turkish = responseLanguage.toLowerCase().startsWith('tr')
  const questionKey = questions.map((item) => `${item.id}:${item.question}`).join('|')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, boolean>>({})
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    setAnswers(Object.fromEntries(questions.map((item) => [item.id, ''])))
    setCustom({})
    setActiveIndex(0)
  }, [questionKey, questions])

  const answeredCount = useMemo(
    () => questions.filter((item) => (answers[item.id] ?? '').trim().length > 0).length,
    [answers, questions],
  )
  const recommended = questions.filter((item) => item.recommendedAnswer)
  const complete = questions.length > 0 && answeredCount === questions.length
  const safeIndex = Math.min(activeIndex, Math.max(questions.length - 1, 0))
  const active = questions[safeIndex]
  const activeAnswer = active ? answers[active.id] ?? '' : ''
  const activeAnswered = activeAnswer.trim().length > 0
  const isLast = safeIndex === questions.length - 1

  const useRecommendation = (item: CouncilClarification) => {
    setAnswers((current) => ({ ...current, [item.id]: item.recommendedAnswer ?? '' }))
    setCustom((current) => ({ ...current, [item.id]: false }))
  }

  const useAllRecommended = () => {
    setAnswers((current) => {
      const next = { ...current }
      recommended.forEach((item) => {
        next[item.id] = item.recommendedAnswer ?? ''
      })
      return next
    })
    setCustom({})
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!complete || continuing) return
    onContinue(
      questions.map((item) => ({
        id: item.id,
        question: item.question,
        answer: answers[item.id].trim(),
      })),
    )
  }

  if (!active) return null
  const inputId = `council-answer-${active.id}`
  const whyId = active.why ? `${inputId}-why` : undefined

  return (
    <form className="councilClarify" onSubmit={submit}>
      <div className="councilClarify__head">
        <div>
          <div className="eyebrow">
            {turkish ? `${questions.length} kısa karar` : `${questions.length} quick decisions`}
          </div>
          <h3 className="councilClarify__title">
            {turkish ? 'Netleştir, Council devam etsin' : 'Clarify, then Council continues'}
          </h3>
        </div>
        {recommended.length === questions.length && (
          <button
            type="button"
            className="councilClarify__useAll"
            onClick={useAllRecommended}
            disabled={continuing}
          >
            {turkish ? 'Tüm önerileri kullan' : 'Use all recommendations'}
          </button>
        )}
      </div>

      <div className="councilClarify__steps" aria-label={turkish ? 'Sorular' : 'Questions'}>
        {questions.map((item, index) => {
          const answered = (answers[item.id] ?? '').trim().length > 0
          return (
            <button
              key={item.id}
              type="button"
              className={`councilClarify__step ${index === safeIndex ? 'councilClarify__step--on' : ''}`}
              aria-current={index === safeIndex ? 'step' : undefined}
              aria-label={`${turkish ? 'Soru' : 'Question'} ${index + 1}`}
              onClick={() => setActiveIndex(index)}
              disabled={continuing}
            >
              {answered ? <IconCheck width={12} height={12} aria-hidden /> : index + 1}
            </button>
          )
        })}
        <span className="councilClarify__position">
          {turkish ? 'Soru' : 'Question'} {safeIndex + 1} / {questions.length}
        </span>
      </div>

      <section className="councilClarify__focus" aria-labelledby={`${inputId}-question`}>
        <h4 id={`${inputId}-question`} className="councilClarify__question">
          {active.question}
        </h4>
        {active.why && (
          <p id={whyId} className="councilClarify__why">
            <span>{turkish ? 'Neden önemli' : 'Why it matters'}</span> {active.why}
          </p>
        )}

        <div className="councilClarify__choices">
          {active.recommendedAnswer && (
            <button
              type="button"
              className={`councilClarify__choice ${!custom[active.id] && activeAnswer === active.recommendedAnswer ? 'councilClarify__choice--on' : ''}`}
              aria-pressed={!custom[active.id] && activeAnswer === active.recommendedAnswer}
              onClick={() => useRecommendation(active)}
              disabled={continuing}
            >
              <span>{turkish ? 'Önerilen' : 'Recommended'}</span>
              <p>{active.recommendedAnswer}</p>
              <strong>{turkish ? 'Önerilen cevabı kullan' : 'Use recommended answer'}</strong>
            </button>
          )}
          <button
            type="button"
            className={`councilClarify__customToggle ${custom[active.id] ? 'councilClarify__customToggle--on' : ''}`}
            aria-expanded={custom[active.id] === true}
            onClick={() => setCustom((current) => ({ ...current, [active.id]: true }))}
            disabled={continuing}
          >
            {turkish ? 'Kendi cevabımı yaz' : 'Write my own answer'}
          </button>
        </div>

        {custom[active.id] && (
          <textarea
            id={inputId}
            className="councilClarify__answer"
            value={activeAnswer}
            onChange={(event) =>
              setAnswers((current) => ({ ...current, [active.id]: event.target.value }))
            }
            placeholder={turkish ? 'Cevabını yaz…' : 'Type your answer…'}
            rows={3}
            aria-describedby={whyId}
            aria-label={turkish ? 'Kendi cevabım' : 'My answer'}
            disabled={continuing}
            autoFocus
          />
        )}
      </section>

      <div className="councilClarify__foot">
        <span className="councilClarify__count" role="status" aria-live="polite">
          {complete && <IconCheck width={13} height={13} aria-hidden />}
          {answeredCount} / {questions.length} {turkish ? 'cevaplandı' : 'answered'}
        </span>
        <div className="councilClarify__nav">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
            disabled={safeIndex === 0 || continuing}
          >
            {turkish ? 'Geri' : 'Back'}
          </button>
          {isLast ? (
            <button
              type="submit"
              className="btn btn--accent councilClarify__continue"
              disabled={!complete || continuing}
            >
              {continuing
                ? turkish ? 'Cevaplar inceleniyor…' : 'Reviewing answers…'
                : turkish ? 'Cevaplarımla devam et' : 'Continue with my answers'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--accent councilClarify__continue"
              onClick={() => setActiveIndex((index) => Math.min(questions.length - 1, index + 1))}
              disabled={!activeAnswered || continuing}
            >
              {turkish ? 'Sonraki soru' : 'Next question'}
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
