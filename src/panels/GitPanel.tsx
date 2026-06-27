import { useEffect, useState } from 'react'
import type { GitFileEntry } from '@shared/domain'
import { useStore } from '../store/useStore'
import { cockpit } from '../lib/cockpit'
import { IconBranch, IconShield } from '../components/icons'

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

export function GitPanel() {
  const git = useStore((s) => s.git)
  const activeProjectId = useStore((s) => s.activeProjectId)
  const refreshApprovals = useStore((s) => s.refreshApprovals)
  const [selected, setSelected] = useState<GitFileEntry | null>(null)
  const [diff, setDiff] = useState<string>('')
  const [commitMsg, setCommitMsg] = useState('')

  useEffect(() => {
    setSelected(null)
    setDiff('')
  }, [activeProjectId])

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

  const requestPush = async (force: boolean) => {
    if (!activeProjectId || !git) return
    await cockpit().approvals.request({
      projectId: activeProjectId,
      actionType: force ? 'git_force_push' : 'git_push',
      summary: `${force ? 'Force-push' : 'Push'} ${git.ahead} commit(s) to origin/${git.branch}`,
      payload: { branch: git.branch, ahead: git.ahead, force },
    })
    await refreshApprovals()
  }

  if (!git) return null
  const grouped = {
    staged: git.files.filter((f) => f.state === 'staged'),
    unstaged: git.files.filter((f) => f.state === 'unstaged' || f.state === 'conflicted'),
    untracked: git.files.filter((f) => f.state === 'untracked'),
  }

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
          <button className="btn" disabled title="Pull (not in this build)">
            Pull
          </button>
          <button className="btn" onClick={() => requestPush(false)} disabled={git.ahead === 0}>
            <IconShield width={13} height={13} /> Push…
          </button>
          <button className="btn btn--danger" onClick={() => requestPush(true)} disabled={git.ahead === 0}>
            <IconShield width={13} height={13} /> Force-push…
          </button>
        </div>
      </div>

      <div className="gitcounts">
        <span className="chip chip--success">{git.stagedCount} staged</span>
        <span className="chip chip--warning">{git.unstagedCount} changed</span>
        <span className="chip">{git.untrackedCount} untracked</span>
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
            <input
              className="git__commitInput"
              placeholder="Commit message…"
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
            />
            <button className="btn btn--accent" disabled={!commitMsg.trim() || grouped.staged.length === 0}>
              Commit {grouped.staged.length > 0 ? `(${grouped.staged.length})` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
