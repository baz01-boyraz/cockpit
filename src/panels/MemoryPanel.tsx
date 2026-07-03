import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
import { IconMemory, IconWarning, IconX } from '../components/icons'
import { MemoryNoteList } from '../components/memory/MemoryNoteList'
import { MemoryReader } from '../components/memory/MemoryReader'
import { MemoryConnections } from '../components/memory/MemoryConnections'
import { MemoryEmptyState } from '../components/memory/MemoryEmptyState'
import { MemoryGraph } from '../components/memory/MemoryGraph'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong writing to the hub.'
}

/** "vision-roadmap" → "Vision Roadmap" — seed heading for a fresh note. */
function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Memory — the per-project markdown knowledge hub (`.cockpit-memory/`).
 * Three zones: note list · reader/editor · connections (backlinks, outgoing,
 * unresolved). Files are the source of truth; this panel only talks to
 * `cockpit().memory`.
 */
export function MemoryPanel() {
  const projectId = useStore((s) => s.activeProjectId)

  const [snapshot, setSnapshot] = useState<MemoryHubSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [note, setNote] = useState<MemoryNote | null>(null)
  const [noteLoading, setNoteLoading] = useState(false)
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [layout, setLayout] = useState<'list' | 'graph'>('list')

  const isDirty = mode === 'edit' && note !== null && draft !== note.content

  /** True when it's safe to leave the editor (clean, or user confirmed). */
  const confirmLeave = useCallback((): boolean => {
    if (!isDirty) return true
    return window.confirm('Discard unsaved changes to this note?')
  }, [isDirty])

  const refreshSnapshot = useCallback(async (): Promise<MemoryHubSnapshot | null> => {
    if (!projectId) return null
    const snap = await cockpit().memory.list(projectId)
    setSnapshot(snap)
    return snap
  }, [projectId])

  // Project switch (or first mount): reset every zone, then load the hub.
  useEffect(() => {
    let cancelled = false
    setSnapshot(null)
    setSelected(null)
    setNote(null)
    setMode('read')
    setPendingCreate(null)
    setNotice(null)
    setLayout('list')
    if (!projectId) {
      setLoading(false)
      return
    }
    setLoading(true)
    cockpit()
      .memory.list(projectId)
      .then((snap) => {
        if (!cancelled) setSnapshot(snap)
      })
      .catch((err: unknown) => {
        if (!cancelled) setNotice(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const openNote = useCallback(
    async (name: string) => {
      if (!projectId || !confirmLeave()) return
      setPendingCreate(null)
      setSelected(name)
      setMode('read')
      setNoteLoading(true)
      try {
        const loaded = await cockpit().memory.read(projectId, name)
        if (loaded) {
          setNote(loaded)
        } else {
          setNote(null)
          setSelected(null)
          setNotice(`“${name}” isn't in the hub anymore.`)
          await refreshSnapshot()
        }
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      } finally {
        setNoteLoading(false)
      }
    },
    [projectId, confirmLeave, refreshSnapshot],
  )

  /** Create a note (seed heading), open it in the editor. */
  const createNote = useCallback(
    async (slug: string): Promise<boolean> => {
      if (!projectId) return false
      if (!confirmLeave()) return false
      try {
        const written = await cockpit().memory.write(projectId, slug, `# ${titleFromSlug(slug)}\n\n`)
        await refreshSnapshot()
        setPendingCreate(null)
        setSelected(written.name)
        setNote(written)
        setDraft(written.content)
        setMode('edit')
        return true
      } catch (err: unknown) {
        setNotice(errorMessage(err))
        return false
      }
    },
    [projectId, confirmLeave, refreshSnapshot],
  )

  const saveDraft = useCallback(async () => {
    if (!projectId || !note) return
    setSaving(true)
    try {
      const written = await cockpit().memory.write(projectId, note.name, draft)
      setNote(written)
      setMode('read')
      await refreshSnapshot()
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1800)
    } catch (err: unknown) {
      setNotice(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }, [projectId, note, draft, refreshSnapshot])

  const renameNote = useCallback(
    async (to: string) => {
      if (!projectId || !note) return
      try {
        const snap = await cockpit().memory.rename(projectId, note.name, to)
        setSnapshot(snap)
        const renamed = await cockpit().memory.read(projectId, to)
        setNote(renamed)
        setSelected(renamed?.name ?? null)
      } catch (err: unknown) {
        setNotice(errorMessage(err))
      }
    },
    [projectId, note],
  )

  const trashNote = useCallback(async () => {
    if (!projectId || !note) return
    try {
      const snap = await cockpit().memory.trash(projectId, note.name)
      setSnapshot(snap)
      setNote(null)
      setSelected(null)
    } catch (err: unknown) {
      setNotice(errorMessage(err))
    }
  }, [projectId, note])

  const known = useMemo(
    () => new Set((snapshot?.notes ?? []).map((n) => n.name)),
    [snapshot],
  )
  const titles = useMemo(
    () => new Map((snapshot?.notes ?? []).map((n) => [n.name, n.title])),
    [snapshot],
  )

  const notes = snapshot?.notes ?? []
  const hubEmpty = !loading && snapshot !== null && notes.length === 0

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">knowledge</div>
          <h2 className="panel__title">Project memory</h2>
        </div>
        {!hubEmpty && !loading && (
          <div className="panel__actions">
            <span className="chip mono">{notes.length} notes</span>
            <span className="chip mono" title="Plain markdown, next to the repo">
              .cockpit-memory/
            </span>
            <div className="memtoggle" role="group" aria-label="Memory layout">
              <button
                className={`memtoggle__btn ${layout === 'list' ? 'memtoggle__btn--active' : ''}`}
                onClick={() => setLayout('list')}
                aria-pressed={layout === 'list'}
              >
                List
              </button>
              <button
                className={`memtoggle__btn ${layout === 'graph' ? 'memtoggle__btn--active' : ''}`}
                onClick={() => setLayout('graph')}
                aria-pressed={layout === 'graph'}
              >
                Graph
              </button>
            </div>
          </div>
        )}
      </div>

      {notice && (
        <div className="memnotice" role="alert">
          <IconWarning width={14} height={14} />
          <span className="memnotice__text">{notice}</span>
          <button
            className="memnotice__dismiss"
            onClick={() => setNotice(null)}
            aria-label="Dismiss error"
          >
            <IconX width={13} height={13} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="memory__busy">
          <span className="memory__pulse" aria-hidden />
          Reading .cockpit-memory/…
        </div>
      ) : hubEmpty ? (
        <MemoryEmptyState onCreate={createNote} />
      ) : (
        <div className="memory__cols">
          <MemoryNoteList
            notes={notes}
            selected={selected}
            onSelect={(name) => void openNote(name)}
            onCreate={createNote}
          />

          {layout === 'graph' && projectId && snapshot ? (
            <MemoryGraph
              projectId={projectId}
              snapshot={snapshot}
              onOpen={(name) => {
                setLayout('list')
                void openNote(name)
              }}
            />
          ) : note && !noteLoading ? (
            <MemoryReader
              key={note.name}
              note={note}
              mode={mode}
              draft={draft}
              saving={saving}
              savedFlash={savedFlash}
              pendingCreate={pendingCreate}
              known={known}
              onDraftChange={setDraft}
              onEdit={() => {
                setDraft(note.content)
                setMode('edit')
              }}
              onSave={() => void saveDraft()}
              onCancelEdit={() => {
                if (confirmLeave()) setMode('read')
              }}
              onRename={(to) => void renameNote(to)}
              onTrash={() => void trashNote()}
              onOpenLink={(name) => void openNote(name)}
              onOfferCreate={setPendingCreate}
              onCreatePending={() => {
                if (pendingCreate) void createNote(pendingCreate)
              }}
              onDismissPending={() => setPendingCreate(null)}
            />
          ) : (
            <section className="card memory__reader memory__reader--idle">
              {noteLoading ? (
                <div className="memory__busy memory__busy--bare">
                  <span className="memory__pulse" aria-hidden />
                  Opening note…
                </div>
              ) : (
                <div className="memidle">
                  <div className="memidle__icon">
                    <IconMemory width={20} height={20} />
                  </div>
                  <div className="memidle__title">Select a note</div>
                  <p className="memidle__sub">
                    Pick a note from the list, or create one — every{' '}
                    <span className="mono">[[wikilink]]</span> you write becomes a connection here.
                  </p>
                </div>
              )}
            </section>
          )}

          <MemoryConnections
            note={noteLoading ? null : note}
            unresolved={snapshot?.unresolved ?? []}
            titles={titles}
            onOpen={(name) => void openNote(name)}
            onCreate={(target) => void createNote(target)}
          />
        </div>
      )}
    </div>
  )
}
