import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CouncilProgressEvent } from '@shared/council'
import { CouncilRoom } from './CouncilRoom'

const events: CouncilProgressEvent[] = [
  {
    projectId: 'p1',
    runId: 'local-1',
    mode: 'spec',
    kind: 'stage',
    stage: 'seats',
    status: 'started',
    message: 'Five seats are reviewing independently.',
    at: '2026-07-11T21:00:00.000Z',
  },
  {
    projectId: 'p1',
    runId: 'local-1',
    mode: 'spec',
    kind: 'seat',
    stage: 'seats',
    status: 'completed',
    seatId: 'contrarian',
    seatLabel: 'Contrarian',
    message: 'Found one scope risk.',
    at: '2026-07-11T21:00:01.000Z',
  },
]

describe('CouncilRoom', () => {
  it('renders safe public activity instead of a blank waiting card', () => {
    const html = renderToStaticMarkup(
      createElement(CouncilRoom, { events, responseLanguage: 'en' }),
    )

    expect(html).toContain('Council room')
    expect(html).toContain('Contrarian')
    expect(html).toContain('Found one scope risk.')
    expect(html).toContain('Concise outputs, not private reasoning')
  })
})
