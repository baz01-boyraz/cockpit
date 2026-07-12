import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { AutomationJob, AutomationSchedule } from '@shared/automation'
import { automationScheduleLabel } from '@shared/automation'
import { cockpit } from '../lib/cockpit'
import { useStore } from '../store/useStore'
import {
  IconAutomation,
  IconCheck,
  IconPause,
  IconPlay,
  IconPlus,
  IconRestart,
  IconShield,
  IconX,
} from '../components/icons'

const RHYTHMS = [
  { value: '60', label: 'Every hour' },
  { value: '360', label: 'Every 6 hours' },
  { value: '720', label: 'Every 12 hours' },
  { value: '1440', label: 'Once a day' },
  { value: 'daily-0900', label: 'Every morning at 09:00' },
] as const

function friendlyMoment(iso: string | null): string {
  if (!iso) return 'Not run yet'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function stateMeta(job: AutomationJob): { label: string; tone: string } {
  if (job.state === 'running') return { label: 'Checking now', tone: 'live' }
  if (!job.enabled || job.state === 'paused') return { label: 'Paused', tone: 'muted' }
  if (job.lastStatus === 'error') return { label: 'Needs attention', tone: 'danger' }
  if (job.lastStatus === 'ok') return { label: 'On schedule', tone: 'success' }
  return { label: 'Ready', tone: 'ready' }
}

interface AutomationJobCardProps {
  job: AutomationJob
  busy: boolean
  onRun: () => void
  onToggle: () => void
  onRemove: () => void
}

export function AutomationJobCard({
  job,
  busy,
  onRun,
  onToggle,
  onRemove,
}: AutomationJobCardProps) {
  const status = stateMeta(job)
  const failed = job.lastStatus === 'error'
  const running = job.state === 'running'

  return (
    <article
      className={`automationCard card card--hover ${job.system ? 'automationCard--system' : ''}`}
      data-automation-id={job.id}
    >
      <span className="automationCard__edge" aria-hidden="true" />
      <div className="automationCard__head">
        <div className="automationCard__identity">
          <span className={`automationCard__glyph automationCard__glyph--${status.tone}`} aria-hidden="true">
            <IconAutomation width={18} height={18} />
          </span>
          <div className="automationCard__nameBlock">
            <div className="automationCard__nameLine">
              <h3 className="automationCard__name">{job.name}</h3>
              {job.system && <span className="automationCard__builtIn">Built-in</span>}
            </div>
            <div className="automationCard__schedule">
              {automationScheduleLabel(job.schedule)}
            </div>
          </div>
        </div>
        <span className={`automationState automationState--${status.tone}`}>
          <span className="automationState__dot" aria-hidden="true" />
          {status.label}
        </span>
      </div>

      <p className="automationCard__instruction">{job.instruction}</p>

      <div className="automationCard__timeline" aria-label="Run timing">
        <div className="automationMoment">
          <span className="automationMoment__label">Last run</span>
          <span className="automationMoment__value mono">{friendlyMoment(job.lastRunAt)}</span>
        </div>
        <span className="automationCard__timelineLink" aria-hidden="true" />
        <div className="automationMoment automationMoment--next">
          <span className="automationMoment__label">Next run</span>
          <span className="automationMoment__value mono">
            {job.enabled ? friendlyMoment(job.nextRunAt) : 'Waiting for you'}
          </span>
        </div>
      </div>

      {(job.lastResult || job.lastError || job.lastStatus === 'never') && (
        <div className={`automationResult ${failed ? 'automationResult--error' : ''}`}>
          <span className="automationResult__icon" aria-hidden="true">
            {failed ? <IconX width={13} height={13} /> : <IconCheck width={13} height={13} />}
          </span>
          <div>
            <div className="automationResult__label">
              {failed ? 'Needs attention' : job.lastStatus === 'never' ? 'First check' : 'Latest note'}
            </div>
            <div className="automationResult__copy">
              {job.lastError ?? job.lastResult ?? 'Hermes will leave a short, plain-language note here.'}
            </div>
          </div>
        </div>
      )}

      <div className="automationCard__actions">
        <button
          type="button"
          className="btn btn--sm automationCard__run"
          onClick={onRun}
          disabled={busy || running || !job.enabled}
        >
          {failed ? <IconRestart width={12} height={12} /> : <IconPlay width={11} height={11} />}
          {failed ? 'Retry now' : running ? 'Running…' : 'Run now'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onToggle}
          disabled={busy || running}
        >
          {job.enabled ? <IconPause width={11} height={11} /> : <IconPlay width={10} height={10} />}
          {job.enabled ? 'Pause' : 'Resume'}
        </button>
        {!job.system && (
          <button
            type="button"
            className="btn btn--ghost btn--danger btn--sm automationCard__delete"
            onClick={onRemove}
            disabled={busy || running}
          >
            <IconX width={11} height={11} />
            Delete
          </button>
        )}
      </div>
    </article>
  )
}

export function AutomationsPanel() {
  const projectId = useStore((state) => state.activeProjectId)
  const [jobs, setJobs] = useState<AutomationJob[]>([])
  const [loading, setLoading] = useState(true)
  const [composerOpen, setComposerOpen] = useState(false)
  const [name, setName] = useState('')
  const [instruction, setInstruction] = useState('')
  const [rhythm, setRhythm] = useState('360')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!projectId) {
      setJobs([])
      setLoading(false)
      return
    }
    try {
      setJobs(await cockpit().automations.list(projectId))
      setError(null)
    } catch {
      setError('Automations could not be loaded. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    void load()
    const unsubscribe = cockpit().automations.onChange((event) => {
      if (event.projectId === projectId) void load()
    })
    return unsubscribe
  }, [load, projectId])

  const summary = useMemo(() => {
    const active = jobs.filter((job) => job.enabled).length
    const needsAttention = jobs.filter((job) => job.lastStatus === 'error').length
    return { active, needsAttention }
  }, [jobs])

  const replace = (updated: AutomationJob | null) => {
    if (!updated) return
    setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)))
  }

  const run = async (job: AutomationJob) => {
    if (!projectId) return
    setBusyId(job.id)
    try {
      replace(await cockpit().automations.run(projectId, job.id))
      setError(null)
    } catch {
      setError('That check could not finish. Nothing was changed; you can retry.')
    } finally {
      setBusyId(null)
    }
  }

  const toggle = async (job: AutomationJob) => {
    if (!projectId) return
    setBusyId(job.id)
    try {
      replace(await cockpit().automations.setEnabled(projectId, job.id, !job.enabled))
      setError(null)
    } catch {
      setError('That schedule could not be updated. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (job: AutomationJob) => {
    if (!projectId) return
    setBusyId(job.id)
    try {
      if (await cockpit().automations.remove(projectId, job.id)) {
        setJobs((current) => current.filter((item) => item.id !== job.id))
      }
      setError(null)
    } catch {
      setError('That watch could not be removed. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    if (!projectId || !name.trim() || !instruction.trim()) return
    const schedule: AutomationSchedule = rhythm === 'daily-0900'
      ? { kind: 'daily', time: '09:00' }
      : { kind: 'interval', minutes: Number(rhythm) }
    setCreating(true)
    try {
      const created = await cockpit().automations.create({
        projectId,
        name: name.trim(),
        instruction: instruction.trim(),
        schedule,
      })
      // The main-process change event can beat this invoke response. Upsert so
      // an eager refresh and the direct response never render the same watch twice.
      setJobs((current) => current.some((job) => job.id === created.id)
        ? current.map((job) => (job.id === created.id ? created : job))
        : [...current, created])
      setName('')
      setInstruction('')
      setRhythm('360')
      setComposerOpen(false)
      setError(null)
    } catch {
      setError('That watch could not be created. Check the wording and try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="panel panel--stagger automations">
      <div className="panel__header">
        <div>
          <div className="eyebrow">Hermes stewardship</div>
          <h2 className="panel__title">
            <IconAutomation width={21} height={21} /> Automations
          </h2>
        </div>
        <div className="panel__actions">
          <span className="automationCount">
            <span className="automationCount__dot" aria-hidden="true" />
            {summary.active} quietly active
          </span>
          <button
            type="button"
            className="btn btn--accent"
            onClick={() => setComposerOpen((open) => !open)}
            aria-expanded={composerOpen}
          >
            {composerOpen ? <IconX width={13} height={13} /> : <IconPlus width={13} height={13} />}
            {composerOpen ? 'Close' : 'New watch'}
          </button>
        </div>
      </div>

      <section className="automationHero" aria-label="Automation safety promise">
        <div className="automationHero__glow" aria-hidden="true" />
        <div className="automationHero__core" aria-hidden="true">
          <span className="automationHero__orbit" />
          <IconAutomation width={25} height={25} />
        </div>
        <div className="automationHero__copy">
          <div className="automationHero__eyebrow">Always listening · never noisy</div>
          <h3>Hermes watches the system, then tells you only what matters.</h3>
          <p>No cron syntax. No log walls. Describe what you care about in your own words.</p>
        </div>
        <div className="automationHero__promise">
          <IconShield width={15} height={15} />
          <span>
            <strong>You stay in control.</strong>
            Suggestions wait for your approval.
          </span>
        </div>
      </section>

      {composerOpen && (
        <form className="automationComposer card" onSubmit={(event) => void create(event)}>
          <div className="automationComposer__intro">
            <span className="automationComposer__step">New</span>
            <div>
              <h3>Create a watch</h3>
              <p>One clear signal is better than a long checklist.</p>
            </div>
          </div>
          <div className="automationComposer__fields">
            <label className="automationField">
              <span>Watch name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                placeholder="e.g. Queue pulse"
                autoFocus
                required
              />
            </label>
            <label className="automationField automationField--wide">
              <span>What should Hermes watch?</span>
              <textarea
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Tell me when this project genuinely needs my attention."
                required
              />
              <small>Plain language is perfect. Hermes receives a safe project-health summary.</small>
            </label>
            <label className="automationField">
              <span>Rhythm</span>
              <select value={rhythm} onChange={(event) => setRhythm(event.target.value)}>
                {RHYTHMS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="automationComposer__actions">
            <span className="automationComposer__hint">Quiet by default — ordinary checks stay here.</span>
            <button type="submit" className="btn btn--accent" disabled={creating}>
              <IconPlus width={13} height={13} />
              {creating ? 'Creating…' : 'Create watch'}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="automationNotice" role="alert">
          <IconX width={13} height={13} />
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <IconX width={12} height={12} />
          </button>
        </div>
      )}

      <div className="automationSectionHead">
        <div>
          <h3>Your watchlist</h3>
          <p>Last result and next check, without the machinery underneath.</p>
        </div>
        {summary.needsAttention > 0 && (
          <span className="automationSectionHead__alert">{summary.needsAttention} needs attention</span>
        )}
      </div>

      {loading ? (
        <div className="automationLoading card">
          <span className="automationLoading__pulse" aria-hidden="true" />
          Waking the watchlist…
        </div>
      ) : jobs.length === 0 ? (
        <div className="automationEmpty card">
          <IconAutomation width={24} height={24} />
          <h3>Your watchlist is quiet.</h3>
          <p>Create one focused watch and Hermes will leave the result here.</p>
        </div>
      ) : (
        <div className="automationGrid">
          {jobs.map((job) => (
            <AutomationJobCard
              key={job.id}
              job={job}
              busy={busyId === job.id}
              onRun={() => void run(job)}
              onToggle={() => void toggle(job)}
              onRemove={() => void remove(job)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
