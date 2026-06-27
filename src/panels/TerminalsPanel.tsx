import { useEffect, useState } from 'react'
import type { TerminalRole, TerminalSession } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { TerminalView } from '../components/TerminalView'
import { IconBolt, IconPlus, IconRestart, IconTerminal, IconX } from '../components/icons'

const MAX = 6

const ROLE_LABEL: Partial<Record<TerminalRole, string>> = {
  frontend: 'frontend',
  backend: 'backend',
  claude: 'claude',
  codex: 'codex',
  git: 'git',
  general: 'shell',
}

export function TerminalsPanel() {
  const terminals = useStore((s) => s.terminals)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshTerminals = useStore((s) => s.refreshTerminals)

  const [activeId, setActiveId] = useState<string | null>(null)
  // Default to split view — the user wants every terminal visible at once.
  const [grid, setGrid] = useState(true)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (terminals.length === 0) {
      setActiveId(null)
    } else if (!activeId || !terminals.some((t) => t.id === activeId)) {
      setActiveId(terminals[terminals.length - 1].id)
    }
  }, [terminals, activeId])

  const atLimit = terminals.length >= MAX
  // Split-view column count scales with terminal count (1 → 1, 2-4 → 2, 5-6 → 3).
  const cols = terminals.length <= 1 ? 1 : terminals.length <= 4 ? 2 : 3

  const create = async (role: TerminalRole | null, name?: string, command?: string | null) => {
    if (!activeProjectId || atLimit) return
    const s = await cockpit().terminals.create({ projectId: activeProjectId, role, name, command })
    await refreshTerminals()
    setActiveId(s.id)
  }

  const launch = async (agent: 'claude' | 'codex') => {
    if (!activeProjectId || atLimit) return
    const s = await cockpit().terminals.launchAgent(activeProjectId, agent)
    await refreshTerminals()
    setActiveId(s.id)
  }

  const kill = async (id: string) => {
    await cockpit().terminals.kill(id)
    await refreshTerminals()
  }
  const restart = async (id: string) => {
    const s = await cockpit().terminals.restart(id)
    await refreshTerminals()
    setActiveId(s.id)
  }

  const commitRename = async (t: TerminalSession) => {
    const name = renameValue.trim()
    setRenaming(null)
    if (name && name !== t.name) {
      await cockpit().terminals.rename(t.id, name, t.role)
      await refreshTerminals()
    }
  }

  if (terminals.length === 0) {
    return (
      <div className="panel">
        <div className="panel__header">
          <div>
            <div className="eyebrow">execution layer</div>
            <h2 className="panel__title">Terminals</h2>
          </div>
        </div>
        <div className="termEmpty card">
          <span className="termEmpty__icon">
            <IconTerminal width={26} height={26} />
          </span>
          <h3 className="termEmpty__title">No terminals yet</h3>
          <p className="termEmpty__sub">
            Spin up to {MAX} real shells per project. Roles are optional — name them however you work.
          </p>
          <div className="termEmpty__actions">
            <button className="btn" onClick={() => create(null)}>
              <IconPlus width={14} height={14} /> Blank shell
            </button>
            <button className="btn" onClick={() => create('frontend', 'Dev server', 'npm run dev')}>
              <IconBolt width={14} height={14} /> Dev server
            </button>
            <button className="btn btn--accent" onClick={() => launch('claude')}>
              <IconBolt width={14} height={14} /> Claude Code
            </button>
            <button className="btn" onClick={() => launch('codex')}>
              <IconBolt width={14} height={14} /> Codex
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel panel--flush">
      <div className="termbar">
        <div className="termbar__tabs">
          {terminals.map((t) => (
            <div
              key={t.id}
              className={`tab ${activeId === t.id && !grid ? 'tab--active' : ''} ${
                t.status !== 'running' ? 'tab--dead' : ''
              }`}
              onClick={() => {
                setActiveId(t.id)
                setGrid(false)
              }}
              onDoubleClick={() => {
                setRenaming(t.id)
                setRenameValue(t.name)
              }}
            >
              <span className={`tab__dot ${t.status === 'running' ? 'tab__dot--live' : ''}`} />
              {renaming === t.id ? (
                <input
                  autoFocus
                  className="tab__rename"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(t)
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="tab__name">{t.name}</span>
              )}
              {t.role && <span className="tab__role mono">{ROLE_LABEL[t.role]}</span>}
              <button
                className="tab__close"
                onClick={(e) => {
                  e.stopPropagation()
                  void kill(t.id)
                }}
              >
                <IconX width={12} height={12} />
              </button>
            </div>
          ))}
          <button
            className="termbar__add"
            disabled={atLimit}
            title={atLimit ? `Max ${MAX} terminals` : 'New terminal'}
            onClick={() => create(null)}
          >
            <IconPlus width={15} height={15} />
          </button>
        </div>

        <div className="termbar__tools">
          <span className="termbar__count mono">
            {terminals.length}/{MAX}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => launch('claude')} disabled={atLimit}>
            <IconBolt width={13} height={13} /> Claude
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => launch('codex')} disabled={atLimit}>
            <IconBolt width={13} height={13} /> Codex
          </button>
          <button
            className={`btn btn--sm ${grid ? 'btn--accent' : ''}`}
            onClick={() => setGrid((g) => !g)}
          >
            {grid ? 'Focus' : 'Grid'}
          </button>
        </div>
      </div>

      <div
        className={`termstage ${grid ? 'termstage--grid' : ''}`}
        style={grid ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
      >
        {terminals.map((t) => {
          const isActive = grid || t.id === activeId
          return (
            <div
              key={t.id}
              className={`termpane ${isActive ? 'termpane--visible' : 'termpane--hidden'} ${
                grid ? 'termpane--tile' : ''
              }`}
            >
              {grid && (
                <div className="termpane__head">
                  <span className={`tab__dot ${t.status === 'running' ? 'tab__dot--live' : ''}`} />
                  <span className="termpane__name">{t.name}</span>
                  <div className="termpane__headTools">
                    <button className="iconbtn" title="Restart" onClick={() => restart(t.id)}>
                      <IconRestart width={13} height={13} />
                    </button>
                    <button className="iconbtn" title="Kill" onClick={() => kill(t.id)}>
                      <IconX width={13} height={13} />
                    </button>
                  </div>
                </div>
              )}
              {t.status === 'running' ? (
                <TerminalView session={t} active={isActive} />
              ) : (
                <div className="termpane__dead">
                  <span>Session ended</span>
                  <button className="btn btn--sm" onClick={() => restart(t.id)}>
                    <IconRestart width={13} height={13} /> Restart
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
