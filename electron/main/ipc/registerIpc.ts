import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type IpcResultMap, type RequestChannelKey, type SystemInfo } from '@shared/ipc'
import { formatIpcError } from '@shared/ipc-errors'
import { requiresApproval } from '@shared/approval-rules'
import { toSummary } from '@shared/named-agents'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '@shared/memory-ledger'
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
  githubCreateRepoInputSchema,
  chatAskSchema,
  hermesChatAskSchema,
  hermesChatClearSchema,
  dismissInsightSchema,
  ingestLogSchema,
  memoryBazReadSchema,
  memoryCaptureSchema,
  memoryLedgerSchema,
  memoryNameSchema,
  memoryRenameSchema,
  memoryResolveReviewSchema,
  memoryWriteSchema,
  projectIdSchema,
  requestApprovalSchema,
  reviewRunSchema,
  reviewRunTextSchema,
  reviewDiffStatSchema,
  councilRunSchema,
  councilScorecardSchema,
  resumeClaudeSchema,
  routeQuerySchema,
  secretKindOnlySchema,
  secretSetSchema,
  type SecretKind,
  swarmCreateCardSchema,
  swarmMoveCardSchema,
  swarmProjectSchema,
  swarmRemoveCardSchema,
  swarmStartCardSchema,
  swarmCompletionReportSchema,
  swarmUpdateCardSchema,
  terminalAttachmentInputSchema,
  terminalIdSchema,
  terminalInputSchema,
  terminalRenameSchema,
  terminalResizeSchema,
} from '@shared/schemas'
import { z } from 'zod'
import type { Services } from '../services/Services'
import { installLatestRelease, isCockpitSource, rebuildAndRelaunch } from '../services/localRebuild'
import { OPENROUTER_SECRET_REF } from '../services/OpenRouterUsageService'

/**
 * Registers every IPC handler. Each handler validates its payload with a Zod
 * schema before doing anything — the renderer is treated as untrusted input.
 * Handlers return plain serialisable data; errors propagate as rejected
 * promises which the renderer surfaces to the user.
 */
export function registerIpc(services: Services): void {
  /**
   * Typed, error-shaping registration. The key binds the handler's return type
   * to `IpcResultMap` (the main process's leg of the CockpitApi contract), and
   * every rejection is centrally formatted — Zod issues become one readable
   * line, absolute home paths are stripped — before crossing to the renderer.
   */
  const handle = <K extends RequestChannelKey>(
    key: K,
    fn: (payload: unknown) => IpcResultMap[K] | Promise<IpcResultMap[K]>,
  ) => {
    ipcMain.handle(IPC[key], async (_e, payload) => {
      try {
        return await fn(payload)
      } catch (err) {
        throw new Error(formatIpcError(err, homedir()))
      }
    })
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
  handle('projectsList', () => services.projects.list())
  handle('projectsAdd', (p) => services.projects.add(addProjectInputSchema.parse(p)))
  handle('projectsSelect', async (p) => {
    const { projectId } = projectIdSchema.parse(p)
    services.projects.select(projectId)
    return services.dashboard(projectId)
  })
  handle('projectsConfig', (p) => services.projects.getConfig(projectIdSchema.parse(p).projectId))
  handle('projectsDashboard', (p) => services.dashboard(projectIdSchema.parse(p).projectId))

  // --- terminals ---
  handle('terminalsList', (p) => services.terminals.list(projectIdSchema.parse(p).projectId))
  handle('terminalsCreate', (p) => services.terminals.create(createTerminalInputSchema.parse(p)))
  handle('terminalsWrite', (p) => {
    const { sessionId, data } = terminalInputSchema.parse(p)
    services.terminals.write(sessionId, data)
  })
  handle('terminalsResize', (p) => {
    const { sessionId, cols, rows } = terminalResizeSchema.parse(p)
    services.terminals.resize(sessionId, cols, rows)
  })
  handle('terminalsKill', (p) => services.terminals.kill(terminalIdSchema.parse(p).sessionId))
  handle('terminalsRestart', (p) => services.terminals.restart(terminalIdSchema.parse(p).sessionId))
  handle('terminalsRename', (p) => {
    const { sessionId, name, role, alias } = terminalRenameSchema.parse(p)
    return services.terminals.rename(sessionId, name, role, alias)
  })
  handle('terminalsLaunchAgent', (p) => {
    const { projectId, agent } = z
      .object({ projectId: z.string().min(1), agent: z.enum(['claude', 'codex']) })
      .parse(p)
    return services.terminals.launchAgent(projectId, agent)
  })
  handle('terminalsClaudeSessions', (p) => {
    const { projectId } = projectIdSchema.parse(p)
    return services.claudeSessions.list(services.projects.get(projectId).path)
  })
  handle('terminalsResumeClaude', (p) => {
    const { projectId, sessionId } = resumeClaudeSchema.parse(p)
    return services.terminals.resumeClaude(projectId, sessionId)
  })
  handle('terminalsAttachImage', (p) =>
    services.attachments.saveTerminalImage(terminalAttachmentInputSchema.parse(p)),
  )

  // --- git ---
  handle('gitStatus', (p) => services.git.status(projectIdSchema.parse(p).projectId))
  handle('gitInitRepo', async (p) => {
    const { projectId } = projectIdSchema.parse(p)
    const result = await services.git.initRepo(projectId)
    services.audit.record({
      projectId,
      actor: 'user',
      actionType: 'git_init',
      summary: `Initialized git repo on branch ${result.branch}`,
    })
    return result
  })
  handle('gitDiff', (p) => services.git.diff(gitDiffInputSchema.parse(p)))
  handle('gitStage', (p) => services.git.stage(gitStageInputSchema.parse(p)))
  handle('gitCommit', (p) => services.git.commit(gitCommitInputSchema.parse(p)))
  handle('gitPush', async (p) => {
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
  handle('githubStatus', (p) => services.github.status(projectIdSchema.parse(p).projectId))
  handle('githubCreateRepo', async (p) => {
    const input = githubCreateRepoInputSchema.parse(p)
    // Bootstrap the local repo first (no-op if it already exists) so `gh repo
    // create --source=.` always has a well-defined git repo to attach to.
    await services.git.initRepo(input.projectId)
    const result = await services.github.createRepo(input)
    services.audit.record({
      projectId: input.projectId,
      actor: 'user',
      actionType: 'github_create_repo',
      summary: `Created GitHub repo ${input.name} (${input.visibility})`,
      payload: { name: input.name, visibility: input.visibility },
    })
    return result
  })

  // --- railway ---
  handle('railwayStatus', (p) => services.railway.status(projectIdSchema.parse(p).projectId))
  handle('railwayServices', (p) => services.railway.services(projectIdSchema.parse(p).projectId))
  handle('railwayEnv', (p) => services.railway.env(projectIdSchema.parse(p).projectId))

  // --- logs ---
  handle('logsList', (p) => services.logs.listLogs(projectIdSchema.parse(p).projectId))
  handle('logsInsights', (p) => services.logs.listInsights(projectIdSchema.parse(p).projectId))
  handle('logsIngest', (p) => services.logs.ingest(ingestLogSchema.parse(p)))
  handle('logsDismissInsight', (p) => {
    const { projectId, matchedPattern } = dismissInsightSchema.parse(p)
    services.logs.dismissInsight(projectId, matchedPattern)
    return { ok: true }
  })
  handle('logsClearInsights', (p) => {
    services.logs.clearInsights(projectIdSchema.parse(p).projectId)
    return { ok: true }
  })

  // --- usage ---
  handle('usageSummary', (p) => services.usage.summarize(projectIdSchema.parse(p).projectId))
  handle('agentUsageGet', (p) => {
    agentUsageRequestSchema.parse(p)
    return services.agentUsage.getReport()
  })
  handle('openRouterUsageStatus', () => services.openRouterUsage.status())

  // --- approvals ---
  handle('approvalsList', (p) => services.approvals.list(projectIdSchema.parse(p).projectId))
  handle('approvalsRequest', (p) => services.approvals.request(requestApprovalSchema.parse(p)))
  handle('approvalsDecide', (p) => {
    const { approvalId, approve } = approvalDecisionSchema.parse(p)
    return services.approvals.decide(approvalId, approve)
  })

  // --- router ---
  handle('routerRoute', (p) => {
    const { projectId, query } = routeQuerySchema.parse(p)
    return services.route(projectId, query)
  })

  // --- review (read-only pre-ship AI diff review) ---
  handle('reviewRun', (p) => {
    const { projectId, model, dir, lens } = reviewRunSchema.parse(p)
    return services.review.run(projectId, { model, dir, lens })
  })
  handle('reviewRunText', (p) => {
    const { projectId, label, content, model } = reviewRunTextSchema.parse(p)
    return services.review.runText(projectId, { label, content }, { model })
  })
  handle('reviewDiffStat', (p) => {
    const { projectId, dir } = reviewDiffStatSchema.parse(p)
    return services.review.diffStat(projectId, { dir })
  })

  // --- council (multi-engine LLM-Council: seats → peer rankings → verdict) ---
  handle('councilRun', (p) => {
    const { projectId, model, mode, dir, question, spec, cardId } = councilRunSchema.parse(p)
    return services.council.run(projectId, { model, mode, dir, question, specText: spec, cardId })
  })
  handle('councilScorecard', (p) =>
    services.council.scorecard(councilScorecardSchema.parse(p).projectId),
  )

  // --- memory hub (per-project markdown knowledge, files are the truth) ---
  handle('memoryList', (p) => services.memory.list(projectIdSchema.parse(p).projectId))
  handle('memoryRead', (p) => {
    const { projectId, name } = memoryNameSchema.parse(p)
    return services.memory.read(projectId, name)
  })
  handle('memoryWrite', (p) => {
    const { projectId, name, content } = memoryWriteSchema.parse(p)
    return services.memory.write(projectId, name, content)
  })
  handle('memoryRename', (p) => {
    const { projectId, from, to } = memoryRenameSchema.parse(p)
    return services.memory.rename(projectId, from, to)
  })
  handle('memoryHealth', (p) => services.memory.health(projectIdSchema.parse(p).projectId))
  handle('memoryCaptureSession', (p) => {
    const { projectId, sessionId, dryRun } = memoryCaptureSchema.parse(p)
    const projectPath = services.projects.get(projectId).path
    const transcriptPath = services.claudeSessions.transcriptPath(projectPath, sessionId)
    return services.memoryPipeline.capture({ projectId, transcriptPath, sessionId, dryRun })
  })
  handle('memoryReviewQueue', (p) => {
    // The unified queue: project-brain proposals plus cross-project Baz-brain ones.
    const { projectId } = projectIdSchema.parse(p)
    return [
      ...services.memoryReviews.listPending(projectBrain(projectId)),
      ...services.memoryReviews.listPending(BAZ_GLOBAL_BRAIN),
    ]
  })
  handle('memoryBazList', () => services.globalMemory.list(BAZ_GLOBAL_BRAIN))
  handle('memoryBazRead', (p) =>
    services.globalMemory.read(BAZ_GLOBAL_BRAIN, memoryBazReadSchema.parse(p).name),
  )
  handle('memoryResolveReview', (p) => {
    const { projectId, reviewId, decision, editedContent } = memoryResolveReviewSchema.parse(p)
    services.memoryPipeline.resolveReview(projectId, reviewId, decision, editedContent)
    return services.memoryReviews.listPending(projectBrain(projectId))
  })
  handle('memoryLedger', (p) => {
    const { projectId, noteSlug } = memoryLedgerSchema.parse(p)
    return services.memoryLedger.list(projectBrain(projectId), noteSlug)
  })
  handle('memoryConsolidate', (p) =>
    services.memoryConsolidator.consolidate(projectIdSchema.parse(p).projectId),
  )
  handle('memoryTrash', (p) => {
    const { projectId, name } = memoryNameSchema.parse(p)
    return services.memory.trash(projectId, name)
  })

  // --- swarm (Phase 6 Kanban board; agent execution arrives in 6.2) ---
  handle('swarmBoard', (p) => services.swarm.board(swarmProjectSchema.parse(p).projectId))
  handle('swarmCreateCard', (p) => services.swarm.createCard(swarmCreateCardSchema.parse(p)))
  handle('swarmUpdateCard', (p) => services.swarm.updateCard(swarmUpdateCardSchema.parse(p)))
  handle('swarmMoveCard', (p) => services.swarm.moveCard(swarmMoveCardSchema.parse(p)))
  handle('swarmRemoveCard', (p) => services.swarm.removeCard(swarmRemoveCardSchema.parse(p)))
  handle('swarmStartCard', (p) => services.swarm.startCard(swarmStartCardSchema.parse(p)))
  handle('swarmParkCard', (p) => services.swarm.parkCard(swarmStartCardSchema.parse(p)))
  handle('swarmAgents', (p) =>
    services.namedAgents.list(swarmProjectSchema.parse(p).projectId).map(toSummary),
  )
  handle('swarmCompletionReport', (p) => {
    const { projectId, cardId } = swarmCompletionReportSchema.parse(p)
    return services.swarm.completionReport(projectId, cardId)
  })

  // --- chat (real answers via the local Claude Code CLI) ---
  handle('chatAsk', (p) => {
    const { projectId, prompt, opts } = chatAskSchema.parse(p)
    return services.chat.ask(projectId, prompt, opts)
  })

  // --- Hermes chat widget (orchestrator persona + cockpit MCP tools; the
  // service keeps conversation history itself since oneshot is stateless) ---
  handle('hermesChatAsk', (p) => {
    const { projectId, message, imagePath } = hermesChatAskSchema.parse(p)
    return services.hermesChat.ask(projectId, message, imagePath)
  })
  handle('hermesChatClear', (p) => {
    const { projectId } = hermesChatClearSchema.parse(p)
    services.hermesChat.clear(projectId)
  })

  // --- secrets (encrypted key/value; the value never crosses back to the
  // renderer — set/has/delete only, deliberately no get). Each kind maps to a
  // fixed storage ref so the ref namespace is owned here, in main, never by the
  // untrusted caller. Not a CLAUDE.md-gated action, so no `guarded()` wrapper —
  // but Zod-validated at the boundary like every other handler. ---
  const SECRET_REFS: Record<SecretKind, string> = {
    openrouter: OPENROUTER_SECRET_REF,
  }
  handle('secretSet', (p) => {
    const { kind, value } = secretSetSchema.parse(p)
    services.secrets.set(SECRET_REFS[kind], value)
  })
  handle('secretHas', (p) => {
    const { kind } = secretKindOnlySchema.parse(p)
    return services.secrets.has(SECRET_REFS[kind])
  })
  handle('secretDelete', (p) => {
    const { kind } = secretKindOnlySchema.parse(p)
    services.secrets.delete(SECRET_REFS[kind])
  })

  // --- audit ---
  handle('auditList', (p) => services.audit.list(projectIdSchema.parse(p).projectId))

  // --- native folder picker ---
  handle('dialogChooseDirectory', async (): Promise<string | null> => {
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
  handle('systemInfo', (): SystemInfo => {
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
  handle('appUpdateStatus', () => services.appUpdate.status())
  handle('appUpdateCheck', () => services.appUpdate.check())
  handle('appUpdateDownload', () => services.appUpdate.download())
  handle('appUpdateInstall', () => services.appUpdate.install())
  handle('appUpdateRefreshEligible', (p) => {
    const { projectId } = projectIdSchema.parse(p)
    try {
      return isCockpitSource(services.projects.get(projectId).path)
    } catch {
      return false
    }
  })
  handle('appUpdateRefresh', async (p) => {
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
  handle('appUpdateInstallRelease', async (p) => {
    const { projectId } = projectIdSchema.parse(p)
    const project = services.projects.get(projectId)
    // Same identity gate as the rebuild path: this runs an npm script from the
    // project directory, so only cockpiT's own verified source qualifies.
    if (!isCockpitSource(project.path)) {
      return {
        ok: false,
        message: 'Installing a release is only available when the active project is the cockpiT source.',
      }
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const confirmOpts = {
      type: 'warning' as const,
      buttons: ['Install latest release', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Replace this local build with the latest GitHub release?',
      detail:
        `Runs "npm run app:install-release" in ${project.path}. Downloads the newest release, ` +
        'quits this app, replaces /Applications/cockpiT.app and reopens it. ' +
        'In-app auto-update works again afterwards — until the next local rebuild.',
    }
    const { response } = win
      ? await dialog.showMessageBox(win, confirmOpts)
      : await dialog.showMessageBox(confirmOpts)
    if (response !== 0) {
      return { ok: false, message: 'Install cancelled.' }
    }
    const result = installLatestRelease(project.path)
    services.audit.record({
      projectId,
      actor: 'user',
      actionType: 'app_install_release',
      summary: result.ok
        ? `Release install started from ${project.path}`
        : `Release install refused: ${result.message}`,
      payload: { path: project.path, ok: result.ok },
    })
    return result
  })
}
