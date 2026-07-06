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
        "Read the project's git status: current branch, ahead/behind counts, and the changed/staged/untracked file list. Read-only — the same snapshot the Git panel shows. Returns a clean 'no-git' snapshot for a folder that isn't a repo.",
      inputShape: projectIdSchema.shape,
      run: async (raw) => ctx.git.status(projectIdSchema.parse(raw).projectId),
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
