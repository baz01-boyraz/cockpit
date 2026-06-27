import { useEffect, useState } from 'react'
import type { MaskedEnvVar, RailwayService as RailwaySvc } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconRailway, IconRestart, IconShield } from '../components/icons'

const TYPE_META: Record<string, { label: string; glyph: string }> = {
  frontend: { label: 'Frontend', glyph: '◐' },
  backend: { label: 'Backend', glyph: '⬡' },
  database: { label: 'Database', glyph: '⛁' },
  worker: { label: 'Worker', glyph: '⚙' },
}

export function RailwayPanel() {
  const connection = useStore((s) => s.railwayConnection)
  const services = useStore((s) => s.railwayServices)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshActive = useStore((s) => s.refreshActive)
  const refreshApprovals = useStore((s) => s.refreshApprovals)
  const connected = connection?.connected ?? false

  const gate = async (svc: RailwaySvc, action: 'restart_service' | 'redeploy') => {
    if (!activeProjectId) return
    await cockpit().approvals.request({
      projectId: activeProjectId,
      actionType: action,
      summary: `${action === 'redeploy' ? 'Redeploy' : 'Restart'} Railway service "${svc.name}"`,
      payload: { service: svc.name, railwayServiceId: svc.railwayServiceId },
    })
    await refreshApprovals()
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <div>
          <div className="eyebrow">infrastructure</div>
          <h2 className="panel__title">
            <IconRailway width={18} height={18} /> Railway
          </h2>
        </div>
        <div className="panel__actions">
          <button className="btn btn--ghost btn--sm" onClick={() => void refreshActive()}>
            <IconRestart width={13} height={13} /> Refresh
          </button>
          <span className={`chip ${connected ? 'chip--success' : 'chip--warning'}`}>
            <span className="chip__dot" />
            {connected ? 'connected' : 'not connected'}
          </span>
        </div>
      </div>

      {connected && connection?.railwayProjectId && (
        <div className="railway__linked mono">
          linked → project <b>{connection.railwayProjectId.slice(0, 8)}</b>
          {connection.railwayEnvironmentId ? ` · env ${connection.railwayEnvironmentId.slice(0, 8)}` : ''}
          <span className="railway__linkedNote">via railway CLI session · no token stored in app</span>
        </div>
      )}

      {!connected && (
        <div className="card railway__connect">
          <div className="railway__connectText">
            <h3>This project isn’t linked to Railway</h3>
            <p>
              Link the project directory with the Railway CLI, then reopen it here:
              <code className="railway__connectCmd mono">railway login &amp;&amp; railway link</code>
              The cockpit reads your CLI session directly — no token is ever stored in the app or sent
              to AI. Mutating actions (restart / redeploy) stay approval-gated.
            </p>
          </div>
          <button className="btn" onClick={() => void refreshActive()} title="Re-check link status">
            <IconRestart width={13} height={13} /> Re-check
          </button>
        </div>
      )}

      <div className="eyebrow railway__sectionLabel">services · everything-on-Railway</div>
      <div className="railway__grid">
        {services.map((svc) => {
          const meta = TYPE_META[svc.serviceType] ?? { label: svc.serviceType, glyph: '∎' }
          return (
            <div key={svc.id} className="card card--hover railway__svc">
              <div className="railway__svcHead">
                <span className="railway__svcGlyph">{meta.glyph}</span>
                <div>
                  <div className="railway__svcName">{svc.name}</div>
                  <div className="railway__svcType mono">{meta.label}</div>
                </div>
                <span className={`chip ${svc.status === 'active' ? 'chip--success' : ''}`}>{svc.status}</span>
              </div>
              {svc.startCommand && <code className="railway__cmd mono">{svc.startCommand}</code>}
              <div className="railway__svcActions">
                <button
                  className="btn btn--sm"
                  disabled={!connected}
                  title={connected ? 'Restart (requires approval)' : 'Requires a linked Railway project'}
                  onClick={() => gate(svc, 'restart_service')}
                >
                  <IconRestart width={13} height={13} /> Restart
                </button>
                <button
                  className="btn btn--sm"
                  disabled={!connected}
                  title={connected ? 'Redeploy (requires approval)' : 'Requires a linked Railway project'}
                  onClick={() => gate(svc, 'redeploy')}
                >
                  <IconShield width={13} height={13} /> Redeploy
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <EnvTable />
    </div>
  )
}

function EnvTable() {
  const activeProjectId = useStore((s) => s.activeProjectId)
  const [vars, setVars] = useState<MaskedEnvVar[]>([])

  useEffect(() => {
    if (activeProjectId) void cockpit().railway.env(activeProjectId).then(setVars)
  }, [activeProjectId])

  return (
    <div className="card railway__env">
      <div className="card__head">
        <div className="card__title">
          <IconShield width={15} height={15} /> Environment variables
        </div>
        <span className="chip chip--warning">masked by default</span>
      </div>
      <table className="envtable">
        <tbody>
          {vars.map((v) => (
            <tr key={v.key}>
              <td className="envtable__key mono">{v.key}</td>
              <td className="envtable__val mono">{v.masked ? v.maskedValue : v.maskedValue}</td>
              <td className="envtable__tag">
                {v.masked ? (
                  <span className="chip chip--danger">secret</span>
                ) : (
                  <span className="chip">public</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="railway__envNote">
        Secret values never leave the main process — the renderer only ever receives masked text.
      </div>
    </div>
  )
}
