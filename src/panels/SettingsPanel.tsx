import { useEffect, useState } from 'react'
import type { ProjectConfig } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconCheck, IconShield, IconX } from '../components/icons'

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
    <div className="panel">
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
              <span key={a} className="chip chip--warning">
                <IconShield width={11} height={11} /> {a}
              </span>
            ))}
          </div>
        </section>

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
