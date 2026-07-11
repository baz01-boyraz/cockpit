import { useEffect, useMemo, useState } from 'react'
import type { CouncilClarification, CouncilClarificationAnswer } from '@shared/council'
import { IconCheck } from './icons'

interface CouncilClarificationFormProps {
  questions: readonly CouncilClarification[]
  continuing: boolean
  onContinue: (answers: CouncilClarificationAnswer[]) => void
}

/**
 * The missing bridge in the old Council flow: questions are real form fields,
 * not prose the user has to copy somewhere else. Defaults remain suggestions
 * until the author explicitly accepts them, individually or all at once.
 */
export function CouncilClarificationForm({
  questions,
  continuing,
  onContinue,
}: CouncilClarificationFormProps) {
  const questionKey = questions.map((item) => `${item.id}:${item.question}`).join('|')
  const [answers, setAnswers] = useState<Record<string, string>>({})

  useEffect(() => {
    setAnswers(Object.fromEntries(questions.map((item) => [item.id, ''])))
    // questionKey changes only when the chairman returns a different interview.
  }, [questionKey])

  const answeredCount = useMemo(
    () => questions.filter((item) => (answers[item.id] ?? '').trim().length > 0).length,
    [answers, questions],
  )
  const recommended = questions.filter((item) => item.recommendedAnswer)
  const complete = questions.length > 0 && answeredCount === questions.length

  const useAllRecommended = () => {
    setAnswers((current) => {
      const next = { ...current }
      recommended.forEach((item) => {
        next[item.id] = item.recommendedAnswer ?? ''
      })
      return next
    })
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

  return (
    <form className="councilClarify" onSubmit={submit}>
      <div className="councilClarify__head">
        <div>
          <div className="eyebrow">your input · {questions.length} short choice{questions.length === 1 ? '' : 's'}</div>
          <h3 className="councilClarify__title">Answer here, then Council will continue</h3>
          <p className="councilClarify__intro">
            There is no separate screen. Your answers stay attached to this request.
          </p>
        </div>
        {recommended.length > 0 && (
          <button
            type="button"
            className="councilClarify__useAll"
            onClick={useAllRecommended}
            disabled={continuing}
          >
            Use recommended answers
          </button>
        )}
      </div>

      <ol className="councilClarify__list">
        {questions.map((item, index) => {
          const inputId = `council-answer-${item.id}`
          const whyId = item.why ? `${inputId}-why` : undefined
          return (
            <li key={item.id} className="councilClarify__item">
              <div className="councilClarify__number" aria-hidden>{index + 1}</div>
              <div className="councilClarify__questionBody">
                <label className="councilClarify__question" htmlFor={inputId}>
                  {item.question}
                </label>
                {item.why && (
                  <p id={whyId} className="councilClarify__why">
                    <span>Why this matters</span> {item.why}
                  </p>
                )}
                {item.recommendedAnswer && (
                  <div className="councilClarify__recommendation">
                    <div>
                      <span>Recommended</span>
                      <p>{item.recommendedAnswer}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setAnswers((current) => ({
                          ...current,
                          [item.id]: item.recommendedAnswer ?? '',
                        }))
                      }
                      disabled={continuing}
                    >
                      Use this
                    </button>
                  </div>
                )}
                <textarea
                  id={inputId}
                  className="councilClarify__answer"
                  value={answers[item.id] ?? ''}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                  placeholder="Type your answer…"
                  rows={2}
                  aria-describedby={whyId}
                  disabled={continuing}
                />
              </div>
            </li>
          )
        })}
      </ol>

      <div className="councilClarify__foot">
        <span className="councilClarify__count" role="status" aria-live="polite">
          {complete && <IconCheck width={13} height={13} aria-hidden />}
          {answeredCount} of {questions.length} answered
        </span>
        <button
          type="submit"
          className="btn btn--accent councilClarify__continue"
          disabled={!complete || continuing}
        >
          {continuing ? 'Reviewing answers…' : 'Continue with my answers'}
        </button>
      </div>
    </form>
  )
}
