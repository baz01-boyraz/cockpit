import { useEffect, useMemo, useState } from 'react'
import type { AppUpdateState, GitFileEntry, GitHubRepositoryStatus } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import {
  IconBranch,
  IconCheck,
  IconCloud,
  IconDownload,
  IconRestart,
  IconShield,
  IconUpload,
  IconWarning,
} from '../components/icons'

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
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshActive = useStore((s) => s.refreshActive)
  const refreshApprovals = useStore((s) => s.refreshApprovals)
  const refreshTerminals = useStore((s) => s.refreshTerminals)
  const refreshAppUpdate = useStore((s) => s.refreshAppUpdate)
  const setView = useStore((s) => s.setView)
  const [selected, setSelected] = useState<GitFileEntry | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [commitMsg, setCommitMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    setSelected(null)
    setDiff('')
    setNotice(null)
  }, [activeProjectId])

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

  const stageAll = async () => {
    if (!activeProjectId) return
    setBusy('stage')
    setNotice(null)
    try {
      await cockpit().git.stage({ projectId: activeProjectId, all: true })
      await refreshActive()
      setNotice('All changes staged.')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const commit = async () => {
    if (!activeProjectId || !commitMsg.trim()) return
    setBusy('commit')
    setNotice(null)
    try {
      const result = await cockpit().git.commit({ projectId: activeProjectId, message: commitMsg.trim() })
      setCommitMsg('')
      await refreshActive()
      setSelected(null)
      setDiff('')
      setNotice(`Committed ${result.commitHash?.slice(0, 8) ?? result.branch}.`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

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

  const commitAndPush = async () => {
    if (!activeProjectId || !commitMsg.trim() || grouped.staged.length === 0) return
    setBusy('commitPush')
    setNotice(null)
    try {
      await cockpit().git.commit({ projectId: activeProjectId, message: commitMsg.trim() })
      setCommitMsg('')
      setSelected(null)
      setDiff('')
      const res = await cockpit().git.push({ projectId: activeProjectId })
      await refreshActive()
      setNotice(`Committed & pushed ${res.branch} → ${res.remote}.`)
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

  return (
    <div className="panel">
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
            disabled={git.ahead === 0 || busy === 'push' || busy === 'commitPush'}
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
          {appUpdate?.phase === 'downloading' ? (
            <div className="git__progress">
              <span style={{ width: `${Math.round(appUpdate.progressPercent ?? 0)}%` }} />
            </div>
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

      <div className="git__cols">
        <div className="card git__files scroll-y">
          {git.files.length === 0 ? (
            <div className="emptyline">Working tree clean.</div>
          ) : (
            (Object.keys(grouped) as (keyof typeof grouped)[]).map((group) =>
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
            )
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
            <div className="git__diffEmpty">
              <p>Select a file to view its diff.</p>
            </div>
          )}
          <div className="git__commit">
            <button className="btn" onClick={stageAll} disabled={busy === 'stage' || git.changedFilesCount === git.stagedCount}>
              <IconUpload width={13} height={13} /> Stage all
            </button>
            <input
              className="git__commitInput"
              placeholder="Commit message…"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            <button className="btn" onClick={commit} disabled={!commitMsg.trim() || grouped.staged.length === 0 || busy === 'commit' || busy === 'commitPush'}>
              Commit {grouped.staged.length > 0 ? `(${grouped.staged.length})` : ''}
            </button>
            <button
              className="btn btn--accent"
              onClick={commitAndPush}
              disabled={!commitMsg.trim() || grouped.staged.length === 0 || busy === 'commit' || busy === 'commitPush'}
              title="Commit staged changes and push to origin"
            >
              <IconUpload width={13} height={13} /> {busy === 'commitPush' ? 'Pushing…' : 'Commit & Push'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
