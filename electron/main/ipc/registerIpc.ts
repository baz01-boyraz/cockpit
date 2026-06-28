import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type SystemInfo } from '@shared/ipc'
import {
  addProjectInputSchema,
  approvalDecisionSchema,
  createTerminalInputSchema,
  gitCommitInputSchema,
  gitDiffInputSchema,
  gitPushInputSchema,
  gitStageInputSchema,
  chatAskSchema,
  ingestLogSchema,
  projectIdSchema,
  requestApprovalSchema,
  routeQuerySchema,
  terminalAttachmentInputSchema,
  terminalIdSchema,
  terminalInputSchema,
  terminalRenameSchema,
  terminalResizeSchema,
} from '@shared/schemas'
import { z } from 'zod'
import type { Services } from '../services/Services'
import { rebuildAndRelaunch } from '../services/localRebuild'

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
    const { sessionId, name, role } = terminalRenameSchema.parse(p)
    return services.terminals.rename(sessionId, name, role)
  })
  handle(IPC.terminalsLaunchAgent, (p) => {
    const { projectId, agent } = z
      .object({ projectId: z.string().min(1), agent: z.enum(['claude', 'codex']) })
      .parse(p)
    return services.terminals.launchAgent(projectId, agent)
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
    const result = await services.git.push(input)
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

  // --- usage ---
  handle(IPC.usageSummary, (p) => services.usage.summarize(projectIdSchema.parse(p).projectId))

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

  // --- chat (real model via Claude Code CLI) ---
  handle(IPC.chatAsk, (p) => {
    const { projectId, prompt, engine } = chatAskSchema.parse(p)
    return services.chat.ask(projectId, prompt, engine)
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
  handle(IPC.appUpdateRefresh, (p) => {
    const { projectId } = projectIdSchema.parse(p)
    return rebuildAndRelaunch(services.projects.get(projectId).path)
  })
}
