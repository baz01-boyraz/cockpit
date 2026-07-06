import { useEffect, useState } from 'react'
import type { ProjectConfig } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconCheck, IconShield, IconX } from '../components/icons'

interface StatusMessage {
  text: string
  error: boolean
}

/**
 * Stores the OpenRouter API key for the upcoming Hermes integration. The value
 * is written straight to the OS keychain via the main process and is never read
 * back to the renderer — this section only ever knows whether a key EXISTS, and
 * shows a masked input for setting a new one. Same secure pattern the app uses
 * for Railway/GitHub tokens.
 */
function HermesKeySection() {
  const [stored, setStored] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<StatusMessage | null>(null)

  useEffect(() => {
    let active = true
    void cockpit()
      .secrets.has('openrouter')
      .then((has) => {
        if (active) setStored(has)
      })
      .catch(() => {
        if (active) setStored(false)
      })
    return () => {
      active = false
    }
  }, [])

  const errorText = (err: unknown, fallback: string) =>
    err instanceof Error ? err.message : fallback

  const save = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      setMessage({ text: 'Enter a key before saving.', error: true })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await cockpit().secrets.set('openrouter', trimmed)
      setStored(true)
      setValue('')
      setMessage({ text: 'Saved to the OS keychain.', error: false })
    } catch (err) {
      setMessage({ text: errorText(err, 'Could not save the key.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await cockpit().secrets.delete('openrouter')
      setStored(false)
      setValue('')
      setMessage({ text: 'Removed the stored key.', error: false })
    } catch (err) {
      setMessage({ text: errorText(err, 'Could not remove the key.'), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card settings__card settings__card--wide">
      <div className="card__title">
        <IconShield width={15} height={15} /> Hermes · OpenRouter
      </div>
      <p className="settings__note">
        Stored encrypted in the OS keychain and only ever read inside the app — the key is never
        shown here again and never sent to the renderer. Powers the upcoming Hermes agent&apos;s
        OpenRouter access.
      </p>
      <div className="secretfield">
        {stored === null ? (
          <span className="secretfield__status secretfield__status--empty">Checking…</span>
        ) : stored ? (
          <span className="secretfield__status secretfield__status--stored">
            <IconCheck width={13} height={13} /> A key is stored
          </span>
        ) : (
          <span className="secretfield__status secretfield__status--empty">
            <IconX width={13} height={13} /> No key stored yet
          </span>
        )}
        <div className="secretfield__row">
          <input
            type="password"
            className="secretfield__input"
            placeholder={stored ? 'Enter a new key to replace it' : 'sk-or-v1-…'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
          <button className="btn btn--accent" onClick={() => void save()} disabled={busy}>
            Save
          </button>
          {stored && (
            <button className="btn btn--danger" onClick={() => void remove()} disabled={busy}>
              Remove
            </button>
          )}
        </div>
        {message && (
          <p className={`secretfield__msg ${message.error ? 'secretfield__msg--error' : ''}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  )
}

export function SettingsPanel() {
  const systemInfo = useStore((s) => s.systemInfo)
  const dashboard = useStore((s) => s.dashboard)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const [config, setConfig] = useState<ProjectConfig | null>(null)

  useEffect(() => {
    if (activeProjectId) void cockpit().projects.config(activeProjectId).then(setConfig)
  }, [activeProjectId])

  const clis = systemInfo?.cliAvailable

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">configuration</div>
          <h2 className="panel__title">Settings</h2>
        </div>
      </div>

      <div className="settings__grid">
        <section className="card settings__card">
          <div className="card__title">Environment</div>
          <dl className="kv">
            <div><dt>Platform</dt><dd className="mono">{systemInfo?.platform ?? '—'}</dd></div>
            <div><dt>App version</dt><dd className="mono">{systemInfo?.appVersion ?? '—'}</dd></div>
            <div><dt>Electron</dt><dd className="mono">{systemInfo?.electron ?? 'browser preview'}</dd></div>
            <div><dt>Node</dt><dd className="mono">{systemInfo?.node ?? '—'}</dd></div>
            <div><dt>Backend</dt><dd>{systemInfo?.isMock ? <span className="chip chip--warning">mock</span> : <span className="chip chip--success">live</span>}</dd></div>
          </dl>
        </section>

        <section className="card settings__card">
          <div className="card__title">Detected CLIs</div>
          <ul className="clilist">
            {clis &&
              (['claude', 'codex', 'railway', 'git', 'gh'] as const).map((c) => (
                <li key={c} className="cliitem">
                  <span className="mono">{c}</span>
                  {clis[c] ? (
                    <span className="cliitem__ok">
                      <IconCheck width={14} height={14} /> available
                    </span>
                  ) : (
                    <span className="cliitem__no">
                      <IconX width={14} height={14} /> not found
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>

        <section className="card settings__card settings__card--wide">
          <div className="card__title">
            <IconShield width={15} height={15} /> Safety policy
          </div>
          <p className="settings__note">
            These actions require explicit approval before they run. Force-push and database reset
            always require approval regardless of this list.
          </p>
          <div className="policygrid">
            {config?.safety.requireApprovalFor.map((a) => (
              <span key={a} className="chip chip--policy">
                <IconShield width={11} height={11} /> {a}
              </span>
            ))}
          </div>
        </section>

        <HermesKeySection />

        <section className="card settings__card settings__card--wide">
          <div className="card__title">Project</div>
          <dl className="kv">
            <div><dt>Name</dt><dd>{dashboard?.project.name ?? '—'}</dd></div>
            <div><dt>Path</dt><dd className="mono">{dashboard?.project.path ?? '—'}</dd></div>
            <div><dt>Config</dt><dd className="mono">.dev-cockpit/project.json</dd></div>
            <div><dt>Stack</dt><dd>{dashboard?.project.techStack.join(', ') || '—'}</dd></div>
            <div><dt>Max terminals</dt><dd className="mono">{config?.terminals.max ?? 6}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  )
}
