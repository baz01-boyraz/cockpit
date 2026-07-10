import { projectIdSchema, reviewDiffStatSchema } from '@shared/schemas'
import type { HermesTool, HermesToolContext } from './hermesToolTypes'

/**
 * Read-only git tools for Hermes' post-dispatch review step (Faz 4 step 7).
 * Both wrap the exact service methods the renderer's IPC path uses and re-parse
 * their input with the same schema — no parallel validation, no write path.
 */
export function createGitTools(ctx: HermesToolContext): HermesTool[] {
  return [
    {
      name: 'get_git_status',
      description:
        "Read the project's live git status plus exact current HEAD commit evidence: branch, ahead/behind counts, changed/staged/untracked files, and headCommit hash/subject. Treat these returned fields as authoritative; never fill missing git facts from an earlier chat turn. Read-only — returns a clean 'no-git' snapshot with headCommit=null for a folder that isn't a repo.",
      inputShape: projectIdSchema.shape,
      run: async (raw) => {
        const { projectId } = projectIdSchema.parse(raw)
        const [snapshot, headCommit] = await Promise.all([
          ctx.git.status(projectId),
          ctx.git.headCommit(projectId),
        ])
        return { ...snapshot, headCommit }
      },
    },
    {
      name: 'get_git_diff_stat',
      description:
        'Cheap `+N −M · K files` summary of the working change set — staged + unstaged edits plus untracked files. Optionally scope to a swarm worktree with `dir` (an absolute path the main process re-validates sits inside the project). A non-repo or clean tree returns zeros, never an error.',
      inputShape: reviewDiffStatSchema.shape,
      run: async (raw) => {
        const { projectId, dir } = reviewDiffStatSchema.parse(raw)
        return ctx.review.diffStat(projectId, { dir })
      },
    },
  ]
}
