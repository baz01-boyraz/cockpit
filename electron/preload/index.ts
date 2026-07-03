import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type CockpitApi, type Unsubscribe } from '@shared/ipc'

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void

/**
 * The only bridge between renderer and main. contextIsolation is on and
 * nodeIntegration is off, so the renderer can touch nothing but this narrow,
 * typed surface. Every method forwards to a validated main-process handler.
 */
function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  return ipcRenderer.invoke(channel, payload) as Promise<T>
}

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener: IpcListener = (_e, payload) => cb(payload as T)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: CockpitApi = {
  projects: {
    list: () => invoke(IPC.projectsList),
    add: (input) => invoke(IPC.projectsAdd, input),
    select: (projectId) => invoke(IPC.projectsSelect, { projectId }),
    config: (projectId) => invoke(IPC.projectsConfig, { projectId }),
    dashboard: (projectId) => invoke(IPC.projectsDashboard, { projectId }),
  },
  terminals: {
    list: (projectId) => invoke(IPC.terminalsList, { projectId }),
    create: (input) => invoke(IPC.terminalsCreate, input),
    write: (sessionId, data) => invoke(IPC.terminalsWrite, { sessionId, data }),
    resize: (sessionId, cols, rows) => invoke(IPC.terminalsResize, { sessionId, cols, rows }),
    kill: (sessionId) => invoke(IPC.terminalsKill, { sessionId }),
    restart: (sessionId) => invoke(IPC.terminalsRestart, { sessionId }),
    rename: (sessionId, name, role, alias) =>
      invoke(IPC.terminalsRename, { sessionId, name, role, alias }),
    launchAgent: (projectId, agent) => invoke(IPC.terminalsLaunchAgent, { projectId, agent }),
    claudeSessions: (projectId) => invoke(IPC.terminalsClaudeSessions, { projectId }),
    resumeClaude: (projectId, sessionId) => invoke(IPC.terminalsResumeClaude, { projectId, sessionId }),
    attachImage: (input) => invoke(IPC.terminalsAttachImage, input),
    onData: (cb) => subscribe(IPC.evtTerminalData, cb),
    onExit: (cb) => subscribe(IPC.evtTerminalExit, cb),
  },
  git: {
    status: (projectId) => invoke(IPC.gitStatus, { projectId }),
    diff: (input) => invoke(IPC.gitDiff, input),
    stage: (input) => invoke(IPC.gitStage, input),
    commit: (input) => invoke(IPC.gitCommit, input),
    push: (input) => invoke(IPC.gitPush, input),
  },
  github: {
    status: (projectId) => invoke(IPC.githubStatus, { projectId }),
  },
  railway: {
    status: (projectId) => invoke(IPC.railwayStatus, { projectId }),
    services: (projectId) => invoke(IPC.railwayServices, { projectId }),
    env: (projectId) => invoke(IPC.railwayEnv, { projectId }),
  },
  logs: {
    list: (projectId) => invoke(IPC.logsList, { projectId }),
    insights: (projectId) => invoke(IPC.logsInsights, { projectId }),
    ingest: (input) => invoke(IPC.logsIngest, input),
    dismissInsight: (projectId, matchedPattern) =>
      invoke(IPC.logsDismissInsight, { projectId, matchedPattern }).then(() => undefined),
    clearInsights: (projectId) => invoke(IPC.logsClearInsights, { projectId }).then(() => undefined),
    onChange: (cb) => subscribe(IPC.evtLogsChanged, () => cb()),
  },
  usage: {
    summary: (projectId) => invoke(IPC.usageSummary, { projectId }),
  },
  agentUsage: {
    get: () => invoke(IPC.agentUsageGet),
  },
  approvals: {
    list: (projectId) => invoke(IPC.approvalsList, { projectId }),
    request: (input) => invoke(IPC.approvalsRequest, input),
    decide: (approvalId, approve) => invoke(IPC.approvalsDecide, { approvalId, approve }),
    onChange: (cb) => subscribe(IPC.evtApprovalsChanged, () => cb()),
  },
  router: {
    route: (projectId, query) => invoke(IPC.routerRoute, { projectId, query }),
  },
  review: {
    run: (projectId, opts) => invoke(IPC.reviewRun, { projectId, model: opts?.model }),
    runText: (projectId, input, opts) =>
      invoke(IPC.reviewRunText, { projectId, ...input, model: opts?.model }),
  },
  memory: {
    list: (projectId) => invoke(IPC.memoryList, { projectId }),
    read: (projectId, name) => invoke(IPC.memoryRead, { projectId, name }),
    write: (projectId, name, content) => invoke(IPC.memoryWrite, { projectId, name, content }),
    rename: (projectId, from, to) => invoke(IPC.memoryRename, { projectId, from, to }),
    trash: (projectId, name) => invoke(IPC.memoryTrash, { projectId, name }),
  },
  swarm: {
    board: (projectId) => invoke(IPC.swarmBoard, { projectId }),
    createCard: (input) => invoke(IPC.swarmCreateCard, input),
    updateCard: (input) => invoke(IPC.swarmUpdateCard, input),
    moveCard: (input) => invoke(IPC.swarmMoveCard, input),
    removeCard: (input) => invoke(IPC.swarmRemoveCard, input),
  },
  chat: {
    ask: (projectId, prompt, opts) => invoke(IPC.chatAsk, { projectId, prompt, opts }),
  },
  audit: {
    list: (projectId) => invoke(IPC.auditList, { projectId }),
  },
  system: {
    info: () => invoke(IPC.systemInfo),
    chooseDirectory: () => invoke(IPC.dialogChooseDirectory),
  },
  appUpdate: {
    status: () => invoke(IPC.appUpdateStatus),
    check: () => invoke(IPC.appUpdateCheck),
    download: () => invoke(IPC.appUpdateDownload),
    install: () => invoke(IPC.appUpdateInstall),
    refresh: (projectId) => invoke(IPC.appUpdateRefresh, { projectId }),
    refreshEligible: (projectId) => invoke(IPC.appUpdateRefreshEligible, { projectId }),
    onChange: (cb) => subscribe(IPC.evtAppUpdateChanged, cb),
  },
}

contextBridge.exposeInMainWorld('cockpit', api)
