export type CouncilJourneyPhase = 'deliberating' | 'clarify' | 'approved' | 'failed' | 'reviewed'

interface CouncilJourneyProps {
  phase: CouncilJourneyPhase
}

/** A three-step answer to the user's most basic question: “what is happening now?” */
export function CouncilJourney({ phase }: CouncilJourneyProps) {
  const finalLabel =
    phase === 'clarify'
      ? 'Answer here'
      : phase === 'approved'
        ? 'Brief ready'
        : phase === 'failed'
          ? 'Try again'
          : phase === 'reviewed'
            ? 'Review ready'
            : 'Next step'

  const steps = [
    { label: 'Request received', state: 'complete' },
    {
      label: phase === 'deliberating' ? 'Council reviewing' : 'Council reviewed',
      state: phase === 'deliberating' ? 'active' : phase === 'failed' ? 'error' : 'complete',
    },
    {
      label: finalLabel,
      state:
        phase === 'deliberating'
          ? 'pending'
          : phase === 'failed'
            ? 'error'
            : phase === 'clarify'
              ? 'active'
              : 'complete',
    },
  ] as const

  return (
    <ol className="councilJourney" aria-label="Council progress">
      {steps.map((step, index) => (
        <li
          key={step.label}
          className={`councilJourney__step councilJourney__step--${step.state}`}
          aria-current={step.state === 'active' ? 'step' : undefined}
        >
          <span className="councilJourney__marker" aria-hidden>
            {step.state === 'complete' ? '✓' : index + 1}
          </span>
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  )
}
