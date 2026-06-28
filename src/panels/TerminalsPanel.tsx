import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { TerminalRole, TerminalSession } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { TerminalView } from '../components/TerminalView'
import {
  IconBolt,
  IconFocus,
  IconGrid,
  IconLayoutAuto,
  IconPlus,
  IconRestart,
  IconTerminal,
  IconX,
} from '../components/icons'

const MAX = 6
const DEFAULT_STAGE_WIDTH = 1180
const MIN_PANE_WIDTH = 240
const MIN_PANE_HEIGHT = 160

const ROLE_LABEL: Partial<Record<TerminalRole, string>> = {
  frontend: 'frontend',
  backend: 'backend',
  claude: 'claude',
  codex: 'codex',
  git: 'git',
  general: 'shell',
}

type LayoutMode = 'auto' | 'focus'
type SplitAxis = 'col' | 'row'

interface SplitState {
  cols: number[]
  rows: number[]
}

interface SplitDrag {
  axis: SplitAxis
  index: number
  start: number
  totalPx: number
  before: number
  after: number
  minPct: number
  cleanup: () => void
}

function equalSplits(count: number): number[] {
  if (count <= 0) return []
  return Array.from({ length: count }, () => 100 / count)
}

function splitSum(values: number[], end: number): number {
  return values.slice(0, end).reduce((sum, value) => sum + value, 0)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function gridTemplate(values: number[]): string {
  return values.map((value) => `minmax(0, ${Number(value.toFixed(3))}fr)`).join(' ')
}

function autoGridShape(count: number, measuredWidth: number): { cols: number; rows: number } {
  const width = measuredWidth || DEFAULT_STAGE_WIDTH

  if (count <= 1) return { cols: 1, rows: 1 }
  if (width < 620) return { cols: 1, rows: count }
  if (count === 2) return width < 820 ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 }
  if (count === 3) return width < 1050 ? { cols: 2, rows: 2 } : { cols: 3, rows: 1 }
  if (count === 4) return { cols: 2, rows: 2 }
  if (width < 1000) return { cols: 2, rows: Math.ceil(count / 2) }
  return { cols: 3, rows: Math.ceil(count / 3) }
}

export function TerminalsPanel({ panelActive = true }: { panelActive?: boolean }) {
  const terminals = useStore((s) => s.terminals)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshTerminals = useStore((s) => s.refreshTerminals)

  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<SplitDrag | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mode, setMode] = useState<LayoutMode>('auto')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [stageWidth, setStageWidth] = useState(DEFAULT_STAGE_WIDTH)
  const [splitState, setSplitState] = useState<SplitState>(() => ({ cols: [100], rows: [100] }))
  const [manualSplits, setManualSplits] = useState(false)
  const [resizing, setResizing] = useState(false)

  const shape = useMemo(() => autoGridShape(terminals.length, stageWidth), [terminals.length, stageWidth])
  const colSplits = splitState.cols.length === shape.cols ? splitState.cols : equalSplits(shape.cols)
  const rowSplits = splitState.rows.length === shape.rows ? splitState.rows : equalSplits(shape.rows)
  const visibleMode: LayoutMode = terminals.length <= 1 ? 'auto' : mode

  const gridStyle = useMemo<CSSProperties>(
    () =>
      visibleMode === 'auto'
        ? {
            gridTemplateColumns: gridTemplate(colSplits),
            gridTemplateRows: gridTemplate(rowSplits),
          }
        : {},
    [colSplits, rowSplits, visibleMode],
  )

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setStageWidth(entry.contentRect.width || DEFAULT_STAGE_WIDTH)
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setSplitState({ cols: equalSplits(shape.cols), rows: equalSplits(shape.rows) })
    setManualSplits(false)
  }, [shape.cols, shape.rows, terminals.length])

  useEffect(() => {
    if (terminals.length === 0) {
      setActiveId(null)
      setMode('auto')
    } else if (!activeId || !terminals.some((t) => t.id === activeId)) {
      setActiveId(terminals[terminals.length - 1].id)
    }
  }, [terminals, activeId])

  useEffect(() => {
    if (terminals.length <= 1 && mode !== 'auto') setMode('auto')
  }, [mode, terminals.length])

  useEffect(() => {
    if (panelActive && terminals.length > 1) setMode('auto')
  }, [panelActive, terminals.length])

  useEffect(() => {
    return () => {
      dragRef.current?.cleanup()
    }
  }, [])

  const atLimit = terminals.length >= MAX

  const resetSplits = () => {
    dragRef.current?.cleanup()
    setSplitState({ cols: equalSplits(shape.cols), rows: equalSplits(shape.rows) })
    setManualSplits(false)
  }

  const beginSplitDrag = (axis: SplitAxis, index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
    const stage = stageRef.current
    const values = axis === 'col' ? colSplits : rowSplits
    if (!stage || !values[index + 1]) return

    event.preventDefault()
    event.stopPropagation()
    dragRef.current?.cleanup()

    const rect = stage.getBoundingClientRect()
    const totalPx = axis === 'col' ? rect.width : rect.height
    const pairTotal = values[index] + values[index + 1]
    const minPx = axis === 'col' ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT
    const pixelMinPct = (minPx / Math.max(totalPx, 1)) * 100
    const minPct = Math.min(Math.max(5, pixelMinPct), Math.max(5, pairTotal / 2 - 1))

    const handleMove = (moveEvent: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return

      const current = drag.axis === 'col' ? moveEvent.clientX : moveEvent.clientY
      const deltaPct = ((current - drag.start) / Math.max(drag.totalPx, 1)) * 100
      const pair = drag.before + drag.after
      const nextBefore = clamp(drag.before + deltaPct, drag.minPct, pair - drag.minPct)
      const nextAfter = pair - nextBefore

      setSplitState((currentState) => {
        if (drag.axis === 'col') {
          const nextCols =
            currentState.cols.length === shape.cols ? [...currentState.cols] : equalSplits(shape.cols)
          nextCols[drag.index] = nextBefore
          nextCols[drag.index + 1] = nextAfter
          return { ...currentState, cols: nextCols }
        }

        const nextRows =
          currentState.rows.length === shape.rows ? [...currentState.rows] : equalSplits(shape.rows)
        nextRows[drag.index] = nextBefore
        nextRows[drag.index + 1] = nextAfter
        return { ...currentState, rows: nextRows }
      })
      setManualSplits(true)
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      setResizing(false)
      dragRef.current = null
    }

    dragRef.current = {
      axis,
      index,
      start: axis === 'col' ? event.clientX : event.clientY,
      totalPx,
      before: values[index],
      after: values[index + 1],
      minPct,
      cleanup: handleUp,
    }
    setResizing(true)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const create = async (role: TerminalRole | null, name?: string, command?: string | null) => {
    if (!activeProjectId || atLimit) return
    const s = await cockpit().terminals.create({ projectId: activeProjectId, role, name, command })
    await refreshTerminals()
    setActiveId(s.id)
    setMode('auto')
  }

  const launch = async (agent: 'claude' | 'codex') => {
    if (!activeProjectId || atLimit) return
    const s = await cockpit().terminals.launchAgent(activeProjectId, agent)
    await refreshTerminals()
    setActiveId(s.id)
    setMode('auto')
  }

  const kill = async (id: string) => {
    await cockpit().terminals.kill(id)
    await refreshTerminals()
  }

  const restart = async (id: string) => {
    const s = await cockpit().terminals.restart(id)
    await refreshTerminals()
    setActiveId(s.id)
    setMode('auto')
  }

  const focusTerminal = (id: string) => {
    setActiveId(id)
    setMode('focus')
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
            Spin up to {MAX} real shells per project. Roles are optional - name them however you work.
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
        <div className="termbar__tabs" role="tablist" aria-label="Terminal sessions">
          {terminals.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={activeId === t.id}
              tabIndex={0}
              className={`tab ${activeId === t.id ? 'tab--active' : ''} ${
                t.status !== 'running' ? 'tab--dead' : ''
              }`}
              onClick={() => setActiveId(t.id)}
              onDoubleClick={() => {
                setRenaming(t.id)
                setRenameValue(t.name)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setActiveId(t.id)
                }
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
                title="Kill terminal"
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
          {visibleMode === 'auto' && manualSplits && (
            <button className="btn btn--ghost btn--sm" onClick={resetSplits} title="Reset terminal layout">
              <IconLayoutAuto width={13} height={13} /> Auto
            </button>
          )}
          <button
            className={`btn btn--sm ${visibleMode === 'focus' ? 'btn--accent' : ''}`}
            disabled={terminals.length <= 1}
            onClick={() => {
              if (visibleMode === 'auto') {
                if (!activeId && terminals[0]) setActiveId(terminals[0].id)
                setMode('focus')
              } else {
                setMode('auto')
              }
            }}
            title={visibleMode === 'auto' ? 'Focus active terminal' : 'Show all terminals'}
          >
            {visibleMode === 'auto' ? <IconFocus width={13} height={13} /> : <IconGrid width={13} height={13} />}
            {visibleMode === 'auto' ? 'Focus' : 'Grid'}
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className={`termstage ${visibleMode === 'auto' ? 'termstage--grid' : 'termstage--focus'} ${
          resizing ? 'termstage--resizing' : ''
        }`}
        style={gridStyle}
      >
        {terminals.map((t) => {
          const isActive = t.id === activeId
          const isVisible = visibleMode === 'auto' || isActive
          return (
            <div
              key={t.id}
              className={`termpane ${isVisible ? 'termpane--visible' : 'termpane--hidden'} ${
                visibleMode === 'auto' ? 'termpane--tile' : ''
              } ${isActive ? 'termpane--active' : ''}`}
              onPointerDownCapture={() => setActiveId(t.id)}
            >
              {visibleMode === 'auto' && (
                <div className="termpane__head">
                  <span className={`tab__dot ${t.status === 'running' ? 'tab__dot--live' : ''}`} />
                  <span className="termpane__name">{t.name}</span>
                  {t.role && <span className="termpane__role mono">{ROLE_LABEL[t.role]}</span>}
                  <div className="termpane__headTools">
                    <button className="iconbtn" title="Focus" onClick={() => focusTerminal(t.id)}>
                      <IconFocus width={13} height={13} />
                    </button>
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
                <TerminalView session={t} active={panelActive && isVisible} />
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

        {visibleMode === 'auto' && terminals.length > 1 && (
          <div className="termsplitLayer" aria-hidden="true">
            {colSplits.slice(0, -1).map((_, index) => (
              <button
                key={`col-${index}`}
                type="button"
                className="termsplit termsplit--col"
                style={{ left: `${splitSum(colSplits, index + 1)}%` }}
                tabIndex={-1}
                onPointerDown={(event) => beginSplitDrag('col', index, event)}
              />
            ))}
            {rowSplits.slice(0, -1).map((_, index) => (
              <button
                key={`row-${index}`}
                type="button"
                className="termsplit termsplit--row"
                style={{ top: `${splitSum(rowSplits, index + 1)}%` }}
                tabIndex={-1}
                onPointerDown={(event) => beginSplitDrag('row', index, event)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
