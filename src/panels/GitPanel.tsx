import { useEffect, useMemo, useState } from 'react'
import type {
  AppUpdateState,
  GitFileEntry,
  GitHubRepositoryStatus,
  TerminalRole,
  TerminalSession,
} from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import type { ReactNode } from 'react'
import {
  IconBeaker,
  IconBolt,
  IconBranch,
  IconCheck,
  IconCloud,
  IconDownload,
  IconPlay,
  IconRestart,
  IconServer,
  IconShield,
  IconStop,
  IconTerminal,
  IconUpload,
  IconWarning,
} from '../components/icons'
import { AnimatedDownload } from '../components/AnimatedDownload'

const STATE_LABEL: Record<string, string> = {
  staged: 'Staged',
  unstaged: 'Changed',
  untracked: 'Untracked',
  conflicted: 'Conflicted',
}
const STATE_CLASS: Record<string, string> = {
  staged: 'gitfile__badge--staged',
  unstaged: 'gitfile__badge--unstaged',
  untracked: 'gitfile__badge--untracked',
  conflicted: 'gitfile__badge--conflict',
}

// The local run flow trades the GitHub release → app-update round-trip for a
// dev build + test suite you can drive straight from the Git panel.
const DEV_COMMAND = 'npm run dev'
const TEST_COMMAND = 'npm test'

function isLive(term: TerminalSession | null): boolean {
  return term?.status === 'running' || term?.status === 'starting'
}

function RunChip({ term }: { term: TerminalSession | null }) {
  if (!term) return <span className="chip">idle</span>
  if (isLive(term)) return <span className="chip chip--success">running</span>
  if (term.status === 'exited') {
    return term.exitCode === 0 ? (
      <span className="chip chip--success">finished</span>
    ) : (
      <span className="chip chip--danger">exited {term.exitCode ?? ''}</span>
    )
  }
  return <span className="chip chip--warning">stopped</span>
}

interface ProcRowProps {
  label: string
  command: string
  hint: string
  icon: ReactNode
  tone: 'dev' | 'test'
  term: TerminalSession | null
  busy: boolean
  onStart: () => void
  onStop: () => void
  onOpen: () => void
}

function ProcRow({ label, command, hint, icon, tone, term, busy, onStart, onStop, onOpen }: ProcRowProps) {
  const live = isLive(term)
  return (
    <div className={`runproc runproc--${tone} ${live ? 'runproc--live' : ''}`}>
      <span className={`runproc__icon runproc__icon--${tone}`} aria-hidden>
        {icon}
        <span className={`runproc__pulse ${live ? 'runproc__pulse--live' : ''}`} />
      </span>
      <div className="runproc__body">
        <div className="runproc__nameRow">
          <span className="runproc__name">{label}</span>
          <RunChip term={term} />
        </div>
        <div className="runproc__sub">
          <span className="runproc__cmd mono">{command}</span>
          <span className="runproc__hint">{hint}</span>
        </div>
      </div>
      <div className="runproc__right">
        {live ? (
          <>
            <button className="btn btn--sm" onClick={onOpen}>
              <IconTerminal width={13} height={13} /> Open
            </button>
            <button className="btn btn--sm btn--danger" onClick={onStop}>
              <IconStop width={11} height={11} /> Stop
            </button>
          </>
        ) : (
          <button className="btn btn--sm btn--run" onClick={onStart} disabled={busy}>
            <IconPlay width={11} height={11} /> {busy ? 'Starting…' : 'Start'}
          </button>
        )}
      </div>
    </div>
  )
}

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="diff mono">
      {diff.split('\n').map((line, i) => {
        let cls = 'diff__line'
        if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff__line--add'
        else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff__line--del'
        else if (line.startsWith('@@')) cls += ' diff__line--hunk'
        else if (line.startsWith('diff ') || line.startsWith('index ')) cls += ' diff__line--meta'
        return (
          <span key={i} className={cls}>
            {line || ' '}
          </span>
        )
      })}
    </pre>
  )
}

function AuthChip({ github }: { github: GitHubRepositoryStatus | null }) {
  if (!github?.connected) return <span className="chip chip--warning">not connected</span>
  if (github.authState === 'authenticated') {
    return (
      <span className="chip chip--success">
        <IconCheck width={12} height={12} /> {github.account?.login ?? 'authenticated'}
      </span>
    )
  }
  if (github.authState === 'invalid') return <span className="chip chip--danger">auth invalid</span>
  return <span className="chip chip--warning">auth needed</span>
}

function workflowLabel(github: GitHubRepositoryStatus | null): string {
  const run = github?.latestWorkflowRun
  if (!run) return 'no workflow data'
  if (run.status !== 'completed') return run.status
  return run.conclusion
}

function updateActionLabel(update: AppUpdateState | null): string {
  if (!update) return 'Check'
  if (update.phase === 'available') return 'Download'
  if (update.phase === 'downloading') return `${Math.round(update.progressPercent ?? 0)}%`
  if (update.phase === 'downloaded') return 'Restart & Install'
  return 'Check'
}

export function GitPanel() {
  const git = useStore((s) => s.git)
  const github = useStore((s) => s.github)
  const appUpdate = useStore((s) => s.appUpdate)
  const terminals = useStore((s) => s.terminals)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshActive = useStore((s) => s.refreshActive)
  const refreshApprovals = useStore((s) => s.refreshApprovals)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const refreshAppUpdate = useStore((s) => s.refreshAppUpdate)
  const setView = useStore((s) => s.setView)
  const [selected, setSelected] = useState<GitFileEntry | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [runIds, setRunIds] = useState<{ dev: string | null; test: string | null }>({ dev: null, test: null })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setSelected(null)
    setDiff('')
    setNotice(null)
    setRunIds({ dev: null, test: null })
  }, [activeProjectId])

  const devTerm = useMemo(() => terminals.find((t) => t.id === runIds.dev) ?? null, [terminals, runIds.dev])
  const testTerm = useMemo(() => terminals.find((t) => t.id === runIds.test) ?? null, [terminals, runIds.test])

  const grouped = useMemo(() => {
    const files = git?.files ?? []
    return {
      staged: files.filter((f) => f.state === 'staged'),
      unstaged: files.filter((f) => f.state === 'unstaged' || f.state === 'conflicted'),
      untracked: files.filter((f) => f.state === 'untracked'),
    }
  }, [git])

  const openDiff = async (file: GitFileEntry) => {
    if (!activeProjectId) return
    setSelected(file)
    const d = await cockpit().git.diff({
      projectId: activeProjectId,
      path: file.path,
      staged: file.state === 'staged',
    })
    setDiff(d.hunks || '(no textual diff)')
  }

  // Spin up a single dev/test process in its own terminal and remember its id so
  // the panel can mirror its live status without leaving the Git view.
  const startProcess = async (kind: 'dev' | 'test') => {
    if (!activeProjectId) return null
    setBusy(kind)
    setNotice(null)
    try {
      const command = kind === 'dev' ? DEV_COMMAND : TEST_COMMAND
      const name = kind === 'dev' ? 'Dev server' : 'Tests'
      const role: TerminalRole = kind === 'dev' ? 'frontend' : 'general'
      const session = await cockpit().terminals.create({ projectId: activeProjectId, role, name, command })
      setRunIds((prev) => ({ ...prev, [kind]: session.id }))
      await refreshTerminals()
      setNotice(`Started ${name.toLowerCase()} — ${command}`)
      return session
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setBusy(null)
    }
  }

  // One click for the whole loop: boot the dev build, kick off the tests, then
  // jump to the terminals so output is visible immediately.
  const startBoth = async () => {
    if (!activeProjectId) return
    setBusy('run')
    setNotice(null)
    try {
      const dev = await cockpit().terminals.create({
        projectId: activeProjectId,
        role: 'frontend',
        name: 'Dev server',
        command: DEV_COMMAND,
      })
      const test = await cockpit().terminals.create({
        projectId: activeProjectId,
        role: 'general',
        name: 'Tests',
        command: TEST_COMMAND,
      })
      setRunIds({ dev: dev.id, test: test.id })
      await refreshTerminals()
      setView('terminals')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const stopProcess = async (kind: 'dev' | 'test') => {
    const sessionId = runIds[kind]
    if (!sessionId) return
    try {
      await cockpit().terminals.kill(sessionId)
      await refreshTerminals()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }

  const openTerminals = () => setView('terminals')

  const doPush = async () => {
    if (!activeProjectId || !git || git.ahead === 0) return
    setBusy('push')
    setNotice(null)
    try {
      const res = await cockpit().git.push({ projectId: activeProjectId })
      await refreshActive()
      setNotice(`Pushed ${res.branch} → ${res.remote}.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Force-push can rewrite remote history, so it stays behind the approval gate.
  const requestForcePush = async () => {
    if (!activeProjectId || !git) return
    await cockpit().approvals.request({
      projectId: activeProjectId,
      actionType: 'git_force_push',
      summary: `Force-push ${git.ahead} commit(s) to origin/${git.branch}`,
      payload: { branch: git.branch, ahead: git.ahead, force: true },
    })
    await refreshApprovals()
    setNotice('Force-push approval requested.')
  }

  const refreshApp = async () => {
    if (!activeProjectId) return
    setBusy('refresh')
    setNotice(null)
    try {
      const res = await cockpit().appUpdate.refresh(activeProjectId)
      setNotice(res.message)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const connectGitHub = async () => {
    if (!activeProjectId) return
    await cockpit().terminals.create({
      projectId: activeProjectId,
      name: 'GitHub auth',
      role: 'git',
      command: 'gh auth login -h github.com',
    })
    await refreshTerminals()
    setView('terminals')
  }

  const runUpdateAction = async () => {
    const api = cockpit().appUpdate
    const phase = appUpdate?.phase
    setBusy('update')
    setNotice(null)
    try {
      if (phase === 'available') await api.download()
      else if (phase === 'downloaded') await api.install()
      else await api.check()
      await refreshAppUpdate()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!git) return null

  const repoName = github?.repository?.fullName ?? github?.remote?.webUrl ?? 'No GitHub remote'
  const updateDisabled =
    busy === 'update' ||
    appUpdate?.phase === 'unsupported' ||
    appUpdate?.phase === 'downloading' ||
    appUpdate?.canCheck === false

  const hasFiles = git.files.length > 0
  const anyLive = isLive(devTerm) || isLive(testTerm)
  const runStatus =
    isLive(devTerm) && isLive(testTerm)
      ? 'dev + tests running'
      : isLive(devTerm)
        ? 'dev running'
        : isLive(testTerm)
          ? 'tests running'
          : 'idle'

  const runSection = (
    <div className="git__run">
      <div className="git__runHead">
        <span className="git__runIcon">
          <IconBolt width={18} height={18} />
        </span>
        <div>
          <div className="eyebrow">local run</div>
          <h3 className="git__runTitle">Preview &amp; test this build locally</h3>
          <p className="git__runSub">
            Boot the dev build and run the test suite straight from here — no GitHub release,
            no app update round-trip. Verify your changes live before you publish.
          </p>
        </div>
      </div>
      <div className="git__runProcs">
        <ProcRow
          label="Dev server"
          command={DEV_COMMAND}
          hint="Hot-reloading preview build"
          icon={<IconServer width={17} height={17} />}
          tone="dev"
          term={devTerm}
          busy={busy === 'dev' || busy === 'run'}
          onStart={() => void startProcess('dev')}
          onStop={() => void stopProcess('dev')}
          onOpen={openTerminals}
        />
        <ProcRow
          label="Tests"
          command={TEST_COMMAND}
          hint="Run the Vitest suite once"
          icon={<IconBeaker width={17} height={17} />}
          tone="test"
          term={testTerm}
          busy={busy === 'test' || busy === 'run'}
          onStart={() => void startProcess('test')}
          onStop={() => void stopProcess('test')}
          onOpen={openTerminals}
        />
      </div>
    </div>
  )

  const runBar = (
    <div className="git__runBar">
      <span className="git__runBarStatus">
        <span className={`runproc__dot ${anyLive ? 'runproc__dot--live' : ''}`} />
        {runStatus}
      </span>
      <div className="git__runBarSpacer" />
      <button className="btn" onClick={openTerminals}>
        <IconTerminal width={13} height={13} /> Open terminals
      </button>
      <button className="btn btn--accent" onClick={startBoth} disabled={busy === 'run'}>
        <IconBolt width={13} height={13} /> {busy === 'run' ? 'Starting…' : 'Start dev + test'}
      </button>
    </div>
  )

  return (
    <div className="panel panel--stagger">
      <div className="panel__header">
        <div>
          <div className="eyebrow">source control</div>
          <h2 className="panel__title">
            <IconBranch width={18} height={18} /> {git.branch}
          </h2>
        </div>
        <div className="panel__actions">
          <span className="chip mono">↑{git.ahead} ↓{git.behind}</span>
          <button className="btn" onClick={() => void refreshActive()}>
            Refresh
          </button>
          <button className="btn" disabled title="Pull will be wired after push execution approvals.">
            Pull
          </button>
          <button
            className="btn btn--accent"
            onClick={doPush}
            disabled={git.ahead === 0 || busy === 'push'}
          >
            <IconUpload width={13} height={13} />{' '}
            {busy === 'push' ? 'Pushing…' : `Push${git.ahead > 0 ? ` (${git.ahead})` : ''}`}
          </button>
          <button className="btn btn--danger" onClick={requestForcePush} disabled={git.ahead === 0}>
            <IconShield width={13} height={13} /> Force-push…
          </button>
        </div>
      </div>

      <div className="git__overview">
        <section className="card git__statusCard">
          <div className="git__statusHead">
            <div>
              <div className="eyebrow">github repository</div>
              <div className="git__repoName mono">{repoName}</div>
            </div>
            <AuthChip github={github} />
          </div>
          <div className="git__metaGrid">
            <div><span>remote</span><strong>{github?.remote?.name ?? '—'}</strong></div>
            <div><span>default</span><strong>{github?.repository?.defaultBranch ?? '—'}</strong></div>
            <div><span>pull request</span><strong>{github?.openPullRequest ? `#${github.openPullRequest.number}` : 'none'}</strong></div>
            <div><span>checks</span><strong>{workflowLabel(github)}</strong></div>
          </div>
          {github?.error ? (
            <div className="git__notice git__notice--warning">
              <IconWarning width={14} height={14} /> {github.error}
            </div>
          ) : null}
          {github?.authState !== 'authenticated' ? (
            <button className="btn git__wideAction" onClick={connectGitHub}>
              <IconCloud width={14} height={14} /> Connect GitHub
            </button>
          ) : null}
        </section>

        <section className="card git__statusCard">
          <div className="git__statusHead">
            <div>
              <div className="eyebrow">baz cockpit update</div>
              <div className="git__repoName mono">
                {appUpdate?.currentVersion ?? '—'} → {appUpdate?.latestVersion ?? 'latest'}
              </div>
            </div>
            <span className={`chip ${appUpdate?.phase === 'downloaded' ? 'chip--success' : ''}`}>
              {appUpdate?.phase ?? 'idle'}
            </span>
          </div>
          <div className="git__updateCopy">
            {appUpdate?.releaseName ?? appUpdate?.error ?? 'Check GitHub Releases for a packaged update.'}
          </div>
          {appUpdate?.phase === 'downloading' || appUpdate?.phase === 'downloaded' ? (
            <AnimatedDownload
              percent={
                appUpdate.phase === 'downloaded' ? 100 : Math.round(appUpdate.progressPercent ?? 0)
              }
              phase={appUpdate.phase === 'downloaded' ? 'downloaded' : 'downloading'}
              version={appUpdate.latestVersion}
            />
          ) : null}
          <button className="btn git__wideAction" onClick={runUpdateAction} disabled={updateDisabled}>
            {appUpdate?.phase === 'downloaded' ? <IconRestart width={14} height={14} /> : <IconDownload width={14} height={14} />}
            {updateActionLabel(appUpdate)}
          </button>
          <button
            className="btn git__wideAction"
            onClick={refreshApp}
            disabled={busy === 'refresh'}
            title="Rebuild this app from the active project's source and relaunch (dev)"
          >
            <IconRestart width={14} height={14} />
            {busy === 'refresh' ? 'Rebuilding…' : 'Rebuild & relaunch'}
          </button>
        </section>
      </div>

      <div className="gitcounts">
        <span className="chip chip--success">{git.stagedCount} staged</span>
        <span className="chip chip--warning">{git.unstagedCount} changed</span>
        <span className="chip">{git.untrackedCount} untracked</span>
        {notice ? <span className="chip">{notice}</span> : null}
      </div>

      {hasFiles ? (
        <div className="git__cols">
          <div className="card git__files scroll-y">
            {(Object.keys(grouped) as (keyof typeof grouped)[]).map((group) =>
              grouped[group].length ? (
                <div key={group} className="gitgroup">
                  <div className="gitgroup__title eyebrow">{STATE_LABEL[group]}</div>
                  {grouped[group].map((f) => (
                    <button
                      key={f.path}
                      className={`gitfile ${selected?.path === f.path ? 'gitfile--active' : ''}`}
                      onClick={() => openDiff(f)}
                    >
                      <span className={`gitfile__badge ${STATE_CLASS[f.state]}`}>
                        {f.index.trim() || f.workingDir.trim() || '?'}
                      </span>
                      <span className="gitfile__path mono">{f.path}</span>
                    </button>
                  ))}
                </div>
              ) : null,
            )}
          </div>

          <div className="card git__diff">
            {selected ? (
              <>
                <div className="git__diffHead mono">{selected.path}</div>
                <div className="git__diffBody scroll-y">
                  <DiffView diff={diff} />
                </div>
              </>
            ) : (
              runSection
            )}
            {runBar}
          </div>
        </div>
      ) : (
        <div className="card git__diff git__diff--solo">
          {runSection}
          {runBar}
        </div>
      )}
    </div>
  )
}
