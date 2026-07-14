import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import type { MemoryHubSnapshot, MemoryNote } from '@shared/memory-hub'
import type { LedgerEntry } from '@shared/memory-ledger'
import { relativeTime } from '@shared/time'
import { IconWarning, IconX } from '../components/icons'
import { NoteBody } from '../components/memory/NoteBody'
import { MemoryNoteList } from '../components/memory/MemoryNoteList'
import { MemoryReader } from '../components/memory/MemoryReader'
import { MemoryConnections } from '../components/memory/MemoryConnections'
import { MemoryEmptyState } from '../components/memory/MemoryEmptyState'
import { MemoryGraph } from '../components/memory/MemoryGraph'
import { MemoryBrainBar } from '../components/memory/MemoryBrainBar'
import { MemoryOverview } from '../components/memory/MemoryOverview'
import {
  notesForLibrary,
  type MemoryLibrary,
} from '../components/memory/memoryLibraryModel'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong writing to the hub.'
}

export interface MemoryNoteActivity {
  history: LedgerEntry[]
  recalls7d: number
  recalls30d: number
}

const EMPTY_NOTE_ACTIVITY: MemoryNoteActivity = {
  history: [],
  recalls7d: 0,
  recalls30d: 0,
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
  const [noteActivity, setNoteActivity] = useState<MemoryNoteActivity | null>(null)
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [layout, setLayout] = useState<'list' | 'graph'>('list')
  const [library, setLibrary] = useState<MemoryLibrary>('active')

  const isDirty = mode === 'edit' && note !== null && draft !== note.content

  /** True when it's safe to leave the editor (clean, or user confirmed). */
  const confirmLeave = useCallback((): boolean => {
    if (!isDirty) return true
    return window.confirm('Discard unsaved changes to this note?')
  }, [isDirty])

  const changeLibrary = useCallback((next: MemoryLibrary) => {
    if (next === library || !confirmLeave()) return
    setLibrary(next)
    setLayout('list')
    setSelected(null)
    setNote(null)
    setNoteActivity(null)
    setMode('read')
    setPendingCreate(null)
  }, [confirmLeave, library])

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
    setNoteActivity(null)
    setMode('read')
    setPendingCreate(null)
    setNotice(null)
    setLayout('list')
    setLibrary('active')
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
      setNoteActivity(null)
      try {
        const [loaded, activity] = await Promise.all([
          cockpit().memory.read(projectId, name),
          cockpit().memory.noteActivity(projectId, name).catch(() => EMPTY_NOTE_ACTIVITY),
        ])
        if (loaded) {
          if (snapshot?.archived.some((entry) => entry.name === loaded.name)) {
            setLibrary('archive')
            setLayout('list')
          } else if (snapshot?.notes.some((entry) => entry.name === loaded.name)) {
            setLibrary('active')
          }
          setNote(loaded)
          setNoteActivity(activity)
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
    [projectId, confirmLeave, refreshSnapshot, snapshot],
  )

  /** Create a note (seed heading), open it in the editor. */
  const createNote = useCallback(
    async (slug: string): Promise<boolean> => {
      if (!projectId) return false
      if (!confirmLeave()) return false
      try {
        const written = await cockpit().memory.write(projectId, slug, `# ${titleFromSlug(slug)}\n\n`)
        await refreshSnapshot()
        setLibrary('active')
        setPendingCreate(null)
        setSelected(written.name)
        setNote(written)
        setNoteActivity(await cockpit().memory.noteActivity(projectId, written.name).catch(() => EMPTY_NOTE_ACTIVITY))
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
      setNoteActivity(await cockpit().memory.noteActivity(projectId, written.name).catch(() => EMPTY_NOTE_ACTIVITY))
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
        setNoteActivity(
          renamed
            ? await cockpit().memory.noteActivity(projectId, renamed.name).catch(() => EMPTY_NOTE_ACTIVITY)
            : null,
        )
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
      setNoteActivity(null)
      setSelected(null)
    } catch (err: unknown) {
      setNotice(errorMessage(err))
    }
  }, [projectId, note])

  const known = useMemo(
    () => new Set([...(snapshot?.notes ?? []), ...(snapshot?.archived ?? [])].map((n) => n.name)),
    [snapshot],
  )
  const titles = useMemo(
    () => new Map([...(snapshot?.notes ?? []), ...(snapshot?.archived ?? [])].map((n) => [n.name, n.title])),
    [snapshot],
  )

  const activeNotes = snapshot?.notes ?? []
  const archivedNotes = snapshot?.archived ?? []
  const notes = notesForLibrary(snapshot, library)
  const hubEmpty = !loading && snapshot !== null && activeNotes.length + archivedNotes.length === 0

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">knowledge</div>
          <h2 className="panel__title">Project memory</h2>
        </div>
        {!hubEmpty && !loading && (
          <div className="panel__actions">
            <span className="chip mono">{activeNotes.length} active</span>
            {archivedNotes.length > 0 && (
              <span className="chip mono">{archivedNotes.length} archived</span>
            )}
            <span className="chip" title="Plain markdown stored in .cockpit-memory/ beside this project">
              Saved with project
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
                onClick={() => {
                  if (!confirmLeave()) return
                  setLibrary('active')
                  setSelected(null)
                  setNote(null)
                  setNoteActivity(null)
                  setMode('read')
                  setLayout('graph')
                }}
                aria-pressed={layout === 'graph'}
                disabled={activeNotes.length === 0}
                title={activeNotes.length === 0 ? 'No active memories to graph' : 'Graph active memories'}
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

      {projectId && !loading && (
        <MemoryBrainBar projectId={projectId} onChanged={() => void refreshSnapshot()} />
      )}

      {loading ? (
        <div className="memory__busy">
          <span className="memory__pulse" aria-hidden />
          Reading .cockpit-memory/…
        </div>
      ) : hubEmpty ? (
        <MemoryEmptyState onCreate={createNote} />
      ) : layout === 'graph' && projectId && snapshot ? (
        <div className="memory__graphstage">
          <MemoryGraph
            projectId={projectId}
            snapshot={snapshot}
            onOpen={(name) => void openNote(name)}
          />
          {/* Quick view floats over the field — a node click must never yank
              the user out of the graph they were exploring. */}
          {(noteLoading || note) && (
            <aside className="memquick" role="dialog" aria-label="Memory quick view">
              {noteLoading ? (
                <div className="memory__busy memory__busy--bare">
                  <span className="memory__pulse" aria-hidden />
                  Opening note…
                </div>
              ) : note ? (
                <>
                  <header className="memquick__head">
                    <div className="memquick__headText">
                      <h3>{note.title}</h3>
                      <span className="memquick__sub mono">
                        {note.name}.md · {relativeTime(note.updatedAt)}
                      </span>
                    </div>
                    <div className="memquick__actions">
                      <button className="btn btn--sm" onClick={() => setLayout('list')}>
                        Open in library
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        aria-label="Close quick view"
                        onClick={() => {
                          setNote(null)
                          setNoteActivity(null)
                          setSelected(null)
                        }}
                      >
                        <IconX width={13} height={13} />
                      </button>
                    </div>
                  </header>
                  <div className="memquick__body scroll-y">
                    <NoteBody
                      content={note.content}
                      known={known}
                      onOpen={(name) => void openNote(name)}
                      onOffer={() => undefined}
                      dedupeTitle={note.title}
                    />
                  </div>
                </>
              ) : null}
            </aside>
          )}
        </div>
      ) : (
        <div className={`memory__cols ${note && !noteLoading ? '' : 'memory__cols--overview'}`}>
          <MemoryNoteList
            key={`${projectId}:${library}`}
            notes={notes}
            selected={selected}
            onSelect={(name) => void openNote(name)}
            onCreate={createNote}
            library={library}
            activeCount={activeNotes.length}
            archiveCount={archivedNotes.length}
            onLibraryChange={changeLibrary}
          />

          {noteLoading ? (
            <section className="card memory__reader memory__reader--idle memory__reader--wide">
                <div className="memory__busy memory__busy--bare">
                  <span className="memory__pulse" aria-hidden />
                  Opening note…
                </div>
            </section>
          ) : note ? (
            <>
              <MemoryReader
                key={note.name}
                note={note}
                activity={noteActivity}
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
              <MemoryConnections
                note={note}
                titles={titles}
                onOpen={(name) => void openNote(name)}
                onCreate={(target) => void createNote(target)}
              />
            </>
          ) : (
            <MemoryOverview
              notes={notes}
              onOpen={(name) => void openNote(name)}
              library={library}
            />
          )}
        </div>
      )}
    </div>
  )
}
