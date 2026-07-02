import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type SystemInfo } from '@shared/ipc'
import { requiresApproval } from '@shared/approval-rules'
import type { ApprovalActionType } from '@shared/domain'
import {
  addProjectInputSchema,
  agentUsageRequestSchema,
  approvalDecisionSchema,
  createTerminalInputSchema,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitPushInputSchema,
  gitStageInputSchema,
  chatAskSchema,
  dismissInsightSchema,
  ingestLogSchema,
  projectIdSchema,
  requestApprovalSchema,
  resumeClaudeSchema,
  routeQuerySchema,
  terminalAttachmentInputSchema,
  terminalIdSchema,
  terminalInputSchema,
  terminalRenameSchema,
  terminalResizeSchema,
} from '@shared/schemas'
import { z } from 'zod'
import type { Services } from '../services/Services'
import { isCockpitSource, rebuildAndRelaunch } from '../services/localRebuild'

/**
 * Registers every IPC handler. Each handler validates its payload with a Zod
 * schema before doing anything — the renderer is treated as untrusted input.
 * Handlers return plain serialisable data; errors propagate as rejected
 * promises which the renderer surfaces to the user.
 */
export function registerIpc(services: Services): void {
  const handle = <T>(channel: string, fn: (payload: unknown) => T | Promise<T>) => {
    ipcMain.handle(channel, async (_e, payload) => fn(payload))
  }

  /**
   * Central approval gate for destructive actions. Consults the shared risk
   * rules and consumes an approved request before running `fn` — enforcement
   * lives here at the trust boundary, never in UI convention. Any future
   * mutating handler (deploy, env_write, db reset, …) MUST go through this.
   */
  const guarded = async <T>(
    actionType: ApprovalActionType,
    input: { projectId: string; approvalId?: string },
    fn: () => T | Promise<T>,
  ): Promise<T> => {
    const configured = services.projects.getConfig(input.projectId).safety.requireApprovalFor
    if (requiresApproval(actionType, configured)) {
      if (!input.approvalId) {
        throw new Error(`${actionType} requires an approved request — request approval first.`)
      }
      services.approvals.consume({
        approvalId: input.approvalId,
        projectId: input.projectId,
        actionType,
      })
    }
    return fn()
  }

  // --- projects ---
  handle(IPC.projectsList, () => services.projects.list())
  handle(IPC.projectsAdd, (p) => services.projects.add(addProjectInputSchema.parse(p)))
  handle(IPC.projectsSelect, async (p) => {
    const { projectId } = projectIdSchema.parse(p)
    services.projects.select(projectId)
    return services.dashboard(projectId)
  })
  handle(IPC.projectsConfig, (p) => services.projects.getConfig(projectIdSchema.parse(p).projectId))
  handle(IPC.projectsDashboard, (p) => services.dashboard(projectIdSchema.parse(p).projectId))

  // --- terminals ---
  handle(IPC.terminalsList, (p) => services.terminals.list(projectIdSchema.parse(p).projectId))
  handle(IPC.terminalsCreate, (p) => services.terminals.create(createTerminalInputSchema.parse(p)))
  handle(IPC.terminalsWrite, (p) => {
    const { sessionId, data } = terminalInputSchema.parse(p)
    services.terminals.write(sessionId, data)
  })
  handle(IPC.terminalsResize, (p) => {
    const { sessionId, cols, rows } = terminalResizeSchema.parse(p)
    services.terminals.resize(sessionId, cols, rows)
  })
  handle(IPC.terminalsKill, (p) => services.terminals.kill(terminalIdSchema.parse(p).sessionId))
  handle(IPC.terminalsRestart, (p) => services.terminals.restart(terminalIdSchema.parse(p).sessionId))
  handle(IPC.terminalsRename, (p) => {
    const { sessionId, name, role, alias } = terminalRenameSchema.parse(p)
    return services.terminals.rename(sessionId, name, role, alias)
  })
  handle(IPC.terminalsLaunchAgent, (p) => {
    const { projectId, agent } = z
      .object({ projectId: z.string().min(1), agent: z.enum(['claude', 'codex']) })
      .parse(p)
    return services.terminals.launchAgent(projectId, agent)
  })
  handle(IPC.terminalsClaudeSessions, (p) => {
    const { projectId } = projectIdSchema.parse(p)
    return services.claudeSessions.list(services.projects.get(projectId).path)
  })
  handle(IPC.terminalsResumeClaude, (p) => {
    const { projectId, sessionId } = resumeClaudeSchema.parse(p)
    return services.terminals.resumeClaude(projectId, sessionId)
  })
  handle(IPC.terminalsAttachImage, (p) =>
    services.attachments.saveTerminalImage(terminalAttachmentInputSchema.parse(p)),
  )

  // --- git ---
  handle(IPC.gitStatus, (p) => services.git.status(projectIdSchema.parse(p).projectId))
  handle(IPC.gitDiff, (p) => services.git.diff(gitDiffInputSchema.parse(p)))
  handle(IPC.gitStage, (p) => services.git.stage(gitStageInputSchema.parse(p)))
  handle(IPC.gitCommit, (p) => services.git.commit(gitCommitInputSchema.parse(p)))
  handle(IPC.gitPush, async (p) => {
    const input = gitPushInputSchema.parse(p)
    // A regular push is the one enabled write path (see CLAUDE.md). Force-push
    // rewrites remote history: it must consume an approved request here, at the
    // boundary — the renderer alone can never trigger it.
    const result = input.force
      ? await guarded('git_force_push', input, () => services.git.push(input))
      : await services.git.push(input)
    services.audit.record({
      projectId: input.projectId,
      actor: 'user',
      actionType: input.force ? 'git_force_push' : 'git_push',
      summary: `${result.forced ? 'Force-pushed' : 'Pushed'} ${result.branch} to ${result.remote}`,
      payload: { branch: result.branch, forced: result.forced },
    })
    return result
  })

  // --- github ---
  handle(IPC.githubStatus, (p) => services.github.status(projectIdSchema.parse(p).projectId))

  // --- railway ---
  handle(IPC.railwayStatus, (p) => services.railway.status(projectIdSchema.parse(p).projectId))
  handle(IPC.railwayServices, (p) => services.railway.services(projectIdSchema.parse(p).projectId))
  handle(IPC.railwayEnv, (p) => services.railway.env(projectIdSchema.parse(p).projectId))

  // --- logs ---
  handle(IPC.logsList, (p) => services.logs.listLogs(projectIdSchema.parse(p).projectId))
  handle(IPC.logsInsights, (p) => services.logs.listInsights(projectIdSchema.parse(p).projectId))
  handle(IPC.logsIngest, (p) => services.logs.ingest(ingestLogSchema.parse(p)))
  handle(IPC.logsDismissInsight, (p) => {
    const { projectId, matchedPattern } = dismissInsightSchema.parse(p)
    services.logs.dismissInsight(projectId, matchedPattern)
    return { ok: true }
  })
  handle(IPC.logsClearInsights, (p) => {
    services.logs.clearInsights(projectIdSchema.parse(p).projectId)
    return { ok: true }
  })

  // --- usage ---
  handle(IPC.usageSummary, (p) => services.usage.summarize(projectIdSchema.parse(p).projectId))
  handle(IPC.agentUsageGet, (p) => {
    agentUsageRequestSchema.parse(p)
    return services.agentUsage.getReport()
  })

  // --- approvals ---
  handle(IPC.approvalsList, (p) => services.approvals.list(projectIdSchema.parse(p).projectId))
  handle(IPC.approvalsRequest, (p) => services.approvals.request(requestApprovalSchema.parse(p)))
  handle(IPC.approvalsDecide, (p) => {
    const { approvalId, approve } = approvalDecisionSchema.parse(p)
    return services.approvals.decide(approvalId, approve)
  })

  // --- router ---
  handle(IPC.routerRoute, (p) => {
    const { projectId, query } = routeQuerySchema.parse(p)
    return services.route(projectId, query)
  })

  // --- chat (real answers via the local Claude Code CLI) ---
  handle(IPC.chatAsk, (p) => {
    const { projectId, prompt, opts } = chatAskSchema.parse(p)
    return services.chat.ask(projectId, prompt, opts)
  })

  // --- audit ---
  handle(IPC.auditList, (p) => services.audit.list(projectIdSchema.parse(p).projectId))

  // --- native folder picker ---
  handle(IPC.dialogChooseDirectory, async (): Promise<string | null> => {
    // Default the picker to the user's general projects home if it exists.
    const bazWork = join(homedir(), 'Documents', 'BAZ-WORK')
    const defaultPath = existsSync(bazWork) ? bazWork : homedir()
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: 'Open a project',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // --- system ---
  handle(IPC.systemInfo, (): SystemInfo => {
    const info = services.systemInfo()
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      electron: process.versions.electron ?? null,
      node: process.versions.node,
      isMock: false,
      cliAvailable: info.cliAvailable,
    }
  })

  // --- app update ---
  handle(IPC.appUpdateStatus, () => services.appUpdate.status())
  handle(IPC.appUpdateCheck, () => services.appUpdate.check())
  handle(IPC.appUpdateDownload, () => services.appUpdate.download())
  handle(IPC.appUpdateInstall, () => services.appUpdate.install())
  handle(IPC.appUpdateRefreshEligible, (p) => {
    const { projectId } = projectIdSchema.parse(p)
    try {
      return isCockpitSource(services.projects.get(projectId).path)
    } catch {
      return false
    }
  })
  handle(IPC.appUpdateRefresh, async (p) => {
    const { projectId } = projectIdSchema.parse(p)
    const project = services.projects.get(projectId)
    // The rebuild runs an npm script from this directory. Identity is verified
    // here in main — a foreign repo declaring an `app:refresh` script must
    // never be an execution target, no matter what the renderer asks for.
    if (!isCockpitSource(project.path)) {
      return {
        ok: false,
        message: 'Rebuild is only available when the active project is the cockpiT source.',
      }
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const confirmOpts = {
      type: 'warning' as const,
      buttons: ['Rebuild & relaunch', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Rebuild cockpiT and relaunch?',
      detail: `Runs "npm run app:refresh" in ${project.path}. The app will quit and replace itself.`,
    }
    const { response } = win
      ? await dialog.showMessageBox(win, confirmOpts)
      : await dialog.showMessageBox(confirmOpts)
    if (response !== 0) {
      return { ok: false, message: 'Rebuild cancelled.' }
    }
    const result = rebuildAndRelaunch(project.path)
    services.audit.record({
      projectId,
      actor: 'user',
      actionType: 'app_refresh',
      summary: result.ok
        ? `Rebuild & relaunch started from ${project.path}`
        : `Rebuild refused: ${result.message}`,
      payload: { path: project.path, ok: result.ok },
    })
    return result
  })
}
