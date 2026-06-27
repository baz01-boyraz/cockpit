import { useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconedFolder } from './ProjectSwitcher.helpers'
import { IconFolder, IconPlus, IconX } from './icons'

export function ProjectSwitcher() {
  const projects = useStore((s) => s.projects)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const selectProject = useStore((s) => s.selectProject)
  const addProject = useStore((s) => s.addProject)
  const toggle = useStore((s) => s.toggleSwitcher)

  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canClose = projects.length > 0

  const onAdd = async () => {
    if (!path.trim()) return
    setError(null)
    try {
      await addProject(path.trim(), name.trim() || undefined)
      setPath('')
      setName('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add project')
    }
  }

  const onBrowse = async () => {
    setError(null)
    const picked = await cockpit().system.chooseDirectory()
    if (!picked) return
    try {
      await addProject(picked)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add project')
    }
  }

  return (
    <div className="modal" onMouseDown={() => canClose && toggle(false)}>
      <div className="modal__panel animate-in" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <div className="eyebrow">workspace</div>
            <h2 className="modal__title">Open a project</h2>
          </div>
          {canClose && (
            <button className="btn btn--ghost btn--sm" onClick={() => toggle(false)}>
              <IconX width={15} height={15} />
            </button>
          )}
        </div>

        <div className="modal__list">
          {projects.map((p) => (
            <button
              key={p.id}
              className={`projcard ${p.id === activeProjectId ? 'projcard--active' : ''}`}
              onClick={() => void selectProject(p.id)}
            >
              <IconedFolder name={p.name} />
              <div className="projcard__body">
                <div className="projcard__name">{p.name}</div>
                <div className="projcard__path mono">{p.path}</div>
              </div>
              <div className="projcard__stack">
                {p.techStack.slice(0, 3).map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            </button>
          ))}
          {projects.length === 0 && (
            <div className="modal__emptyState">No projects yet — add one below to get started.</div>
          )}
        </div>

        <div className="modal__add">
          <button className="btn btn--accent modal__browse" onClick={onBrowse}>
            <IconFolder width={15} height={15} /> Browse for a folder…
          </button>
          <div className="modal__addDivider">
            <span>or paste an absolute path</span>
          </div>
          <div className="modal__addRow">
            <input
              className="modal__input mono"
              placeholder="/absolute/path/to/project"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            />
            <input
              className="modal__input modal__input--name"
              placeholder="Name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAdd()}
            />
            <button className="btn btn--accent" onClick={onAdd} disabled={!path.trim()}>
              <IconPlus width={14} height={14} /> Add
            </button>
          </div>
          {error && <div className="modal__error">{error}</div>}
        </div>
      </div>
    </div>
  )
}
