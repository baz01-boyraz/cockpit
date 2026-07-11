import { describe, expect, it, vi } from 'vitest'
import { CockpitEvents } from '../electron/main/events'
import { CardOutputTracker } from '../electron/main/services/hermes/CardOutputTracker'
import { HermesChecksService } from '../electron/main/services/hermes/HermesChecksService'
import { createHermesTools, type HermesTool, type HermesToolContext } from '../electron/main/services/hermes/hermesTools'
import type { BoardColumn, CardStatus, KanbanCard } from '../shared/kanban'
import type { AgentUsageReport, ApprovalRequest, ErrorInsight, GitSnapshot, LogEvent } from '../shared/domain'
import type { CouncilResult } from '../shared/council'
import type { DiffStat } from '../shared/review'
import type { MemoryHubSnapshot, MemoryNote } from '../shared/memory-hub'
import type { ReviewItem } from '../shared/memory-review'
import { BAZ_GLOBAL_BRAIN, projectBrain } from '../shared/memory-ledger'
import { ROLE_IDS } from '../shared/agent-taxonomy'
import type { ProjectService } from '../electron/main/services/ProjectService'

/** Minimal ProjectService stand-in — only `.get(...).path` is read by the checks service. */
function stubProjects(path: string): Pick<ProjectService, 'get'> {
  return { get: () => ({ path }) } as unknown as Pick<ProjectService, 'get'>
}

function makeCard(over: Partial<KanbanCard> = {}): KanbanCard {
  return {
    id: 'c1',
    projectId: 'p1',
    title: 'Card',
    body: '',
    status: 'todo',
    position: 1024,
    role: null,
    persona: null,
    agent: null,
    assignments: [],
    pipelineStep: 0,
    councilSessionId: null,
    terminalSessionId: null,
    worktreePath: null,
    branch: null,
    createdAt: 't0',
    updatedAt: 't0',
    ...over,
  }
}

function boardWith(card: KanbanCard): BoardColumn[] {
  return [{ status: card.status, cards: [card] }]
}

const EMPTY_BOARD: BoardColumn[] = []

const USAGE_REPORT: AgentUsageReport = {
  providers: [
    {
      provider: 'claude',
      label: 'Claude',
      available: true,
      plan: 'Pro',
      windows: [{ label: 'Session', usedPercent: 42, resetAt: null }],
      reason: null,
      fetchedAt: 't0',
    },
  ],
}

const GIT_SNAPSHOT: GitSnapshot = {
  id: 'git-1',
  projectId: 'p1',
  branch: 'main',
  ahead: 0,
  behind: 0,
  changedFilesCount: 1,
  stagedCount: 0,
  unstagedCount: 1,
  untrackedCount: 0,
  files: [{ path: 'src/x.ts', state: 'unstaged', index: ' ', workingDir: 'M' }],
  createdAt: 't0',
}

const GIT_HEAD = {
  hash: '10243f539d8055d542834ecd576e2134b4679501',
  shortHash: '10243f5',
  subject: 'chore(release): bump version to 0.2.2',
}

const DIFF_STAT: DiffStat = { files: 2, insertions: 10, deletions: 3 }

const MEMORY_SNAPSHOT: MemoryHubSnapshot = { notes: [], unresolved: [] }

function makeNote(over: Partial<MemoryNote> = {}): MemoryNote {
  return {
    name: 'summary',
    title: 'Summary',
    content: 'body',
    updatedAt: 't0',
    backlinks: [],
    outgoing: [],
    unresolved: [],
    ...over,
  }
}

function makeReviewItem(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'r1',
    brain: 'project:p1',
    kind: 'new',
    slug: 'note',
    title: 'Note',
    proposedContent: 'content',
    reason: 'why',
    existingContent: null,
    sourceId: null,
    alsoTrash: null,
    status: 'pending',
    createdAt: 't0',
    resolvedAt: null,
    ...over,
  }
}

/** A spec-gate result whose verdict carries a parseable "Refined Spec" section. */
function makeCouncilResult(over: Partial<CouncilResult> = {}): CouncilResult {
  return {
    ok: true,
    mode: 'spec',
    seats: [],
    rankings: [],
    aggregate: [
      { seatId: 'builder', averageRank: 1.3, count: 3 },
      { seatId: 'contrarian', averageRank: 2.1, count: 3 },
    ],
    labelToSeat: {},
    verdict: '## 🎯 Verdict\nAPPROVED\n\n### 📋 Refined Spec\n**Goal**: Ship the widget\n**Acceptance criteria**: it renders',
    specVerdict: { kind: 'approved', questions: [] },
    error: null,
    stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 0, durationMs: 10 },
    sessionId: 'sess-1',
    ...over,
  }
}

interface Calls {
  create: unknown[]
  update: unknown[]
  start: unknown[]
  board: string[]
  completionReport: unknown[]
  councilRun: unknown[]
  gitStatus: string[]
  gitHead: string[]
  diffStat: unknown[]
  checks: unknown[]
  screenshot: unknown[]
  memoryList: string[]
  memoryListDocs: string[]
  memoryWrite: unknown[]
  memoryReviewCreate: unknown[]
  auditRecord: unknown[]
  listPending: string[]
  resolveReview: unknown[]
  curationSweep: string[]
  logsList: string[]
  insightsList: string[]
  approvalsRequest: unknown[]
}

/** A context whose service methods record calls and return fixed fixtures. */
function makeContext(over: Partial<HermesToolContext> = {}): { ctx: HermesToolContext; calls: Calls } {
  const calls: Calls = {
    create: [],
    update: [],
    start: [],
    board: [],
    completionReport: [],
    councilRun: [],
    gitStatus: [],
    gitHead: [],
    diffStat: [],
    checks: [],
    screenshot: [],
    memoryList: [],
    memoryListDocs: [],
    memoryWrite: [],
    memoryReviewCreate: [],
    auditRecord: [],
    listPending: [],
    resolveReview: [],
    curationSweep: [],
    logsList: [],
    insightsList: [],
    approvalsRequest: [],
  }
  const swarm: HermesToolContext['swarm'] = {
    createCard: (input) => {
      calls.create.push(input)
      return EMPTY_BOARD
    },
    updateCard: (input) => {
      calls.update.push(input)
      return EMPTY_BOARD
    },
    startCard: async (input) => {
      calls.start.push(input)
      return { gated: false, board: EMPTY_BOARD }
    },
    board: (projectId) => {
      calls.board.push(projectId)
      return EMPTY_BOARD
    },
    completionReport: async (projectId, cardId) => {
      calls.completionReport.push({ projectId, cardId })
      return {
        cardId,
        title: 'Add the widget',
        branch: 'swarm/add-the-widget-1a2b',
        diffStat: { files: 3, insertions: 42, deletions: 7 },
        acceptance: ['It renders', 'It has a test'],
        hasCouncilSpec: true,
        finishedAt: 't2',
      }
    },
  }
  const ctx: HermesToolContext = {
    swarm,
    council: {
      run: async (projectId, opts) => {
        calls.councilRun.push({ projectId, opts })
        return makeCouncilResult()
      },
      scorecard: () => [],
    },
    agentUsage: { getReport: async () => USAGE_REPORT },
    cardOutput: new CardOutputTracker(new CockpitEvents()),
    git: {
      status: async (projectId) => {
        calls.gitStatus.push(projectId)
        return GIT_SNAPSHOT
      },
      headCommit: async (projectId) => {
        calls.gitHead.push(projectId)
        return GIT_HEAD
      },
    },
    review: {
      diffStat: async (projectId, opts) => {
        calls.diffStat.push({ projectId, opts })
        return DIFF_STAT
      },
    },
    checks: {
      run: async (projectId, check) => {
        calls.checks.push({ projectId, check })
        return {
          check,
          command: `npm ${check}`,
          exitCode: 0,
          timedOut: false,
          stdout: 'ok',
          stderr: '',
          truncated: false,
        }
      },
    },
    screenshot: {
      capture: async (projectId, req) => {
        calls.screenshot.push({ projectId, req })
        return { path: `/tmp/${req.label}.png`, url: req.url ?? 'http://localhost:47616', label: req.label, rebuilt: true }
      },
    },
    memory: {
      list: (projectId) => {
        calls.memoryList.push(projectId)
        return MEMORY_SNAPSHOT
      },
      listDocs: (projectId) => {
        calls.memoryListDocs.push(projectId)
        return [
          {
            name: 'landing-page-direction',
            content: 'Landing pages use molten obsidian and copper accents.',
            updatedAt: 't1',
          },
        ]
      },
      write: (projectId, name, content) => {
        calls.memoryWrite.push({ projectId, name, content })
        return makeNote({ name, content })
      },
    },
    memoryReviews: {
      listPending: (brain) => {
        calls.listPending.push(brain)
        return [makeReviewItem({ brain })]
      },
      create: (input) => {
        calls.memoryReviewCreate.push(input)
        return makeReviewItem({ brain: input.brain, slug: input.slug, proposedContent: input.proposedContent })
      },
    },
    memoryPipeline: {
      resolveReview: (projectId, reviewId, decision, editedContent) => {
        calls.resolveReview.push({ projectId, reviewId, decision, editedContent })
      },
    },
    memoryCuration: {
      sweep: async (projectId) => {
        calls.curationSweep.push(projectId)
        return { proposals: 2 }
      },
    },
    logs: {
      listLogs: (projectId) => {
        calls.logsList.push(projectId)
        return LOG_EVENTS
      },
      listInsights: (projectId) => {
        calls.insightsList.push(projectId)
        return ERROR_INSIGHTS
      },
    },
    approvals: {
      request: (input) => {
        calls.approvalsRequest.push(input)
        return makeApproval({
          projectId: input.projectId,
          actionType: input.actionType,
          summary: input.summary,
          payload: input.payload ?? {},
        })
      },
    },
    audit: {
      record: (input) => {
        calls.auditRecord.push(input)
        return {
          id: 'aud-1',
          projectId: input.projectId,
          actor: input.actor,
          actionType: input.actionType,
          summary: input.summary,
          payloadRedacted: input.payload ?? {},
          createdAt: 't0',
        }
      },
    },
    ...over,
  }
  return { ctx, calls }
}

const LOG_EVENTS: LogEvent[] = [
  {
    id: 'log-1',
    projectId: 'p1',
    sourceType: 'terminal',
    sourceId: 's1',
    level: 'error',
    message: 'Cannot find module x',
    metadata: {},
    createdAt: 't0',
  },
]

const ERROR_INSIGHTS: ErrorInsight[] = [
  {
    id: 'ins-1',
    projectId: 'p1',
    logEventId: 'log-1',
    title: 'Missing module',
    likelyCause: 'A dependency is not installed',
    suggestedAction: 'Run npm install',
    suggestedAgent: 'claude',
    severity: 'high',
    matchedPattern: 'missing-module',
    createdAt: 't1',
    firstSeenAt: 't0',
    lastSeenAt: 't1',
    occurrences: 3,
  },
]

function makeApproval(over: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'apr-1',
    projectId: 'p1',
    actionType: 'propose_open_swarm_card',
    riskLevel: 'medium',
    summary: 'reason — title',
    payload: {},
    status: 'pending',
    createdAt: 't0',
    resolvedAt: null,
    ...over,
  }
}

function toolNamed(ctx: HermesToolContext, name: string): HermesTool {
  const tool = createHermesTools(ctx).find((t) => t.name === name)
  if (!tool) throw new Error(`tool ${name} not registered`)
  return tool
}

describe('Hermes MCP tools — the scoped tool set', () => {
  it('exposes exactly the registered tools and nothing else', () => {
    const { ctx } = makeContext()
    expect(createHermesTools(ctx).map((t) => t.name).sort()).toEqual([
      'council_refine_spec',
      'create_swarm_card',
      'get_completion_report',
      'get_git_diff_stat',
      'get_git_status',
      'get_log_intelligence',
      'get_pending_memory_reviews',
      'get_swarm_status',
      'get_usage_quota',
      'propose_swarm_card',
      'read_memory_recent',
      'resolve_memory_review',
      'run_checks',
      'run_memory_sweep',
      'start_swarm_card',
      'subscribe_card_output',
      'take_app_screenshot',
      'update_swarm_card',
      'write_memory_summary',
    ])
  })

  describe('run_memory_sweep', () => {
    it('triggers the curation sweep and returns a compact proposal count + message', async () => {
      const { ctx, calls } = makeContext()
      const out = (await toolNamed(ctx, 'run_memory_sweep').run({ projectId: 'p1' })) as {
        proposals: number
        message: string
      }
      expect(calls.curationSweep).toEqual(['p1'])
      expect(out.proposals).toBe(2)
      expect(out.message).toMatch(/review queue/i)
    })

    it('reports a no-op cleanly when the sweep returns null (empty hub / model down)', async () => {
      const { ctx } = makeContext({ memoryCuration: { sweep: async () => null } })
      const out = (await toolNamed(ctx, 'run_memory_sweep').run({ projectId: 'p1' })) as {
        proposals: number
        message: string
      }
      expect(out.proposals).toBe(0)
      expect(out.message).toMatch(/nothing was changed/i)
    })
  })

  describe('get_log_intelligence', () => {
    it('returns the project logs and insights, read-only', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'get_log_intelligence').run({ projectId: 'p1' })
      expect(calls.logsList).toEqual(['p1'])
      expect(calls.insightsList).toEqual(['p1'])
      expect(result).toEqual({ logs: LOG_EVENTS, insights: ERROR_INSIGHTS })
    })

    it('rejects invalid input (missing projectId)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'get_log_intelligence').run({})).rejects.toThrow()
      expect(calls.logsList).toEqual([])
      expect(calls.insightsList).toEqual([])
    })
  })

  describe('propose_swarm_card', () => {
    it('records an approval request and never opens a card', async () => {
      const { ctx, calls } = makeContext()
      const assignments = [{ role: ROLE_IDS[0], spec: null }]
      const result = await toolNamed(ctx, 'propose_swarm_card').run({
        projectId: 'p1',
        title: 'Fix the flaky test',
        body: 'It fails intermittently in CI',
        reason: 'Recurring CI failure',
        assignments,
      })
      // It requested an approval with the stashed payload...
      expect(calls.approvalsRequest).toEqual([
        {
          projectId: 'p1',
          actionType: 'propose_open_swarm_card',
          summary: 'Recurring CI failure — Fix the flaky test',
          payload: { title: 'Fix the flaky test', body: 'It fails intermittently in CI', assignments },
        },
      ])
      // ...and returned the approval id to the caller.
      expect(result).toMatchObject({ approvalId: 'apr-1', status: 'pending' })
      // ...but NEVER touched the swarm board itself.
      expect(calls.create).toEqual([])
      expect(calls.update).toEqual([])
      expect(calls.start).toEqual([])
    })

    it('rejects invalid input (missing reason)', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'propose_swarm_card').run({ projectId: 'p1', title: 'x' }),
      ).rejects.toThrow()
      expect(calls.approvalsRequest).toEqual([])
    })

    it('rejects a title over the 200 char cap', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'propose_swarm_card').run({
          projectId: 'p1',
          title: 'x'.repeat(201),
          reason: 'because',
        }),
      ).rejects.toThrow()
      expect(calls.approvalsRequest).toEqual([])
    })
  })

  describe('get_completion_report', () => {
    it('returns a compact text report: summary line, branch, and acceptance list', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'get_completion_report').run({
        projectId: 'p1',
        cardId: 'c1',
      })) as { report: string }
      expect(calls.completionReport).toEqual([{ projectId: 'p1', cardId: 'c1' }])
      expect(result.report).toContain('"Add the widget" ready for review — +42 −7 across 3 files')
      expect(result.report).toContain('2 acceptance criteria')
      expect(result.report).toContain('Branch: swarm/add-the-widget-1a2b')
      expect(result.report).toContain('- It renders')
      expect(result.report).toContain('- It has a test')
    })

    it('propagates a missing-card error from the service', async () => {
      const { ctx } = makeContext({
        swarm: {
          createCard: () => EMPTY_BOARD,
          updateCard: () => EMPTY_BOARD,
          startCard: async () => ({ gated: false, board: EMPTY_BOARD }),
          board: () => EMPTY_BOARD,
          completionReport: async () => {
            throw new Error('Card c9 not found in this project.')
          },
        },
      })
      await expect(
        toolNamed(ctx, 'get_completion_report').run({ projectId: 'p1', cardId: 'c9' }),
      ).rejects.toThrow(/not found/)
    })

    it('rejects invalid input (missing cardId)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'get_completion_report').run({ projectId: 'p1' })).rejects.toThrow()
      expect(calls.completionReport).toEqual([])
    })
  })

  describe('create_swarm_card', () => {
    it('validates and forwards to swarm.createCard', async () => {
      const { ctx, calls } = makeContext()
      await toolNamed(ctx, 'create_swarm_card').run({ projectId: 'p1', title: 'Build it' })
      expect(calls.create).toEqual([{ projectId: 'p1', title: 'Build it' }])
    })

    it('rejects invalid input (empty title)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'create_swarm_card').run({ projectId: 'p1', title: '' })).rejects.toThrow()
      expect(calls.create).toEqual([])
    })

    it('rejects a title over the 200 char cap', async () => {
      const { ctx } = makeContext()
      await expect(
        toolNamed(ctx, 'create_swarm_card').run({ projectId: 'p1', title: 'x'.repeat(201) }),
      ).rejects.toThrow()
    })

    it('threads a councilSessionId through to swarm.createCard', async () => {
      const { ctx, calls } = makeContext()
      await toolNamed(ctx, 'create_swarm_card').run({
        projectId: 'p1',
        title: 'Build the gated thing',
        body: 'refined spec body',
        councilSessionId: 'sess-1',
      })
      expect(calls.create).toEqual([
        { projectId: 'p1', title: 'Build the gated thing', body: 'refined spec body', councilSessionId: 'sess-1' },
      ])
    })
  })

  describe('council_refine_spec', () => {
    it('APPROVED: returns a compact payload with the refined spec and sessionId, no seat prose', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'council_refine_spec').run({
        projectId: 'p1',
        spec: '**Goal**: ship it',
        cardId: 'c9',
      })) as Record<string, unknown>

      // Ran the spec gate with the right mode + material.
      expect(calls.councilRun).toEqual([
        { projectId: 'p1', opts: { mode: 'spec', specText: '**Goal**: ship it', cardId: 'c9' } },
      ])
      expect(result.verdictKind).toBe('APPROVED')
      expect(result.questions).toEqual([])
      expect(result.refinedSpec).toBe('**Goal**: Ship the widget\n**Acceptance criteria**: it renders')
      expect(result.ranking).toBe('Builder 1.3 · Contrarian 2.1')
      expect(result.sessionId).toBe('sess-1')
      // Compact by contract: the full seat outputs never cross back.
      expect(result).not.toHaveProperty('seats')
    })

    it('NEEDS_CLARIFICATION: lists the author questions to relay verbatim', async () => {
      const council: HermesToolContext['council'] = {
        run: async () =>
          makeCouncilResult({
            verdict: '## 🎯 Verdict\nNEEDS_CLARIFICATION\n\n### ❓ Questions for the author\n1. What scope?\n2. Which environment?',
            specVerdict: { kind: 'needs_clarification', questions: ['What scope?', 'Which environment?'] },
          }),
        scorecard: () => [],
      }
      const { ctx } = makeContext({ council })
      const result = (await toolNamed(ctx, 'council_refine_spec').run({
        projectId: 'p1',
        spec: 'do a thing',
      })) as Record<string, unknown>

      expect(result.verdictKind).toBe('NEEDS_CLARIFICATION')
      expect(result.questions).toEqual(['What scope?', 'Which environment?'])
      expect(result.sessionId).toBe('sess-1')
    })

    it('synthesis-failed: a run with no parseable gate degrades cleanly, not as clarification', async () => {
      const council: HermesToolContext['council'] = {
        run: async () =>
          makeCouncilResult({
            ok: false,
            verdict: null,
            specVerdict: null,
            aggregate: [],
            error: 'Every council seat failed to respond.',
            sessionId: null,
          }),
        scorecard: () => [],
      }
      const { ctx } = makeContext({ council })
      const result = (await toolNamed(ctx, 'council_refine_spec').run({
        projectId: 'p1',
        spec: 'do a thing',
      })) as Record<string, unknown>

      expect(result.verdictKind).toBe('synthesis-failed')
      expect(result.questions).toEqual([])
      expect(result.refinedSpec).toBeNull()
      expect(result.error).toBe('Every council seat failed to respond.')
      expect(result.sessionId).toBeNull()
    })

    it('surfaces a clean tool error when council.run throws', async () => {
      const council: HermesToolContext['council'] = {
        run: async () => {
          throw new Error('engine unavailable')
        },
        scorecard: () => [],
      }
      const { ctx } = makeContext({ council })
      await expect(
        toolNamed(ctx, 'council_refine_spec').run({ projectId: 'p1', spec: 'x' }),
      ).rejects.toThrow('engine unavailable')
    })

    it('rejects an empty spec at the boundary (before the council runs)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'council_refine_spec').run({ projectId: 'p1', spec: '' })).rejects.toThrow()
      expect(calls.councilRun).toEqual([])
    })

    it('rejects a spec over the 16,000 char cap', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'council_refine_spec').run({ projectId: 'p1', spec: 'x'.repeat(16_001) }),
      ).rejects.toThrow()
      expect(calls.councilRun).toEqual([])
    })
  })

  describe('update_swarm_card', () => {
    it('validates and forwards a role pipeline', async () => {
      const { ctx, calls } = makeContext()
      const assignments = [{ role: ROLE_IDS[0], spec: null }]
      await toolNamed(ctx, 'update_swarm_card').run({ projectId: 'p1', cardId: 'c1', assignments })
      expect(calls.update).toEqual([{ projectId: 'p1', cardId: 'c1', assignments }])
    })

    it('rejects a pipeline longer than 6 steps', async () => {
      const { ctx, calls } = makeContext()
      const assignments = Array.from({ length: 7 }, () => ({ role: ROLE_IDS[0], spec: null }))
      await expect(
        toolNamed(ctx, 'update_swarm_card').run({ projectId: 'p1', cardId: 'c1', assignments }),
      ).rejects.toThrow()
      expect(calls.update).toEqual([])
    })

    it('rejects an unknown role id', async () => {
      const { ctx } = makeContext()
      await expect(
        toolNamed(ctx, 'update_swarm_card').run({
          projectId: 'p1',
          cardId: 'c1',
          assignments: [{ role: 'not-a-real-role', spec: null }],
        }),
      ).rejects.toThrow()
    })
  })

  describe('start_swarm_card', () => {
    it('validates and forwards to swarm.startCard', async () => {
      const { ctx, calls } = makeContext()
      await toolNamed(ctx, 'start_swarm_card').run({ projectId: 'p1', cardId: 'c1' })
      expect(calls.start).toEqual([{ projectId: 'p1', cardId: 'c1' }])
    })

    it('rejects invalid input (missing cardId)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'start_swarm_card').run({ projectId: 'p1' })).rejects.toThrow()
      expect(calls.start).toEqual([])
    })
  })

  describe('get_swarm_status', () => {
    it('reads the board for the project', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'get_swarm_status').run({ projectId: 'p1' })
      expect(calls.board).toContain('p1')
      expect(result).toEqual({ board: EMPTY_BOARD })
    })

    it('rejects invalid input (missing projectId)', async () => {
      const { ctx } = makeContext()
      await expect(toolNamed(ctx, 'get_swarm_status').run({})).rejects.toThrow()
    })
  })

  describe('get_usage_quota', () => {
    it('returns the sanitized usage report', async () => {
      const { ctx } = makeContext()
      const result = await toolNamed(ctx, 'get_usage_quota').run({})
      expect(result).toEqual(USAGE_REPORT)
    })

    it('rejects a non-object payload', async () => {
      const { ctx } = makeContext()
      await expect(toolNamed(ctx, 'get_usage_quota').run('nope')).rejects.toThrow()
    })
  })

  describe('subscribe_card_output', () => {
    /** Wire a real tracker + events bus and a mutable board for the running card. */
    function setup(initialStatus: CardStatus = 'in_progress', sessionId: string | null = 's1') {
      const events = new CockpitEvents()
      const tracker = new CardOutputTracker(events)
      let card = makeCard({ id: 'c1', status: initialStatus, terminalSessionId: sessionId })
      const swarm: HermesToolContext['swarm'] = {
        createCard: () => EMPTY_BOARD,
        updateCard: () => EMPTY_BOARD,
        startCard: async () => ({ gated: false, board: EMPTY_BOARD }),
        board: () => boardWith(card),
        completionReport: async () => {
          throw new Error('not used in subscribe_card_output tests')
        },
      }
      const { ctx } = makeContext({ swarm, cardOutput: tracker })
      const tool = toolNamed(ctx, 'subscribe_card_output')
      const run = (): Promise<Record<string, unknown>> =>
        tool.run({ projectId: 'p1', cardId: 'c1' }) as Promise<Record<string, unknown>>
      const setStatus = (status: CardStatus) => {
        card = { ...card, status }
      }
      const emit = (sid: string, data: string) => events.emitTyped('terminal:data', { sessionId: sid, data, at: 't' })
      const exit = (sid: string) =>
        events.emitTyped('terminal:exit', {
          sessionId: sid,
          projectId: 'p1',
          role: 'claude',
          exitCode: 0,
          signal: null,
        })
      return { run, emit, exit, setStatus, tracker }
    }

    it('tails the running card and returns output produced since the previous call', async () => {
      const { run, emit } = setup()

      const first = await run()
      expect(first).toMatchObject({ sessionId: 's1', isDone: false, output: '' })

      emit('s1', 'building...')
      const second = await run()
      expect(second).toMatchObject({ isDone: false, output: 'building...' })
    })

    it('reports done and stops tracking once the session exits', async () => {
      const { run, emit, exit, tracker } = setup()
      await run() // begin tracking

      emit('s1', 'final line')
      exit('s1')
      const done = await run()
      expect(done).toMatchObject({ isDone: true, output: 'final line', exitCode: 0 })
      // Once done, the session is untracked so nothing more is retained.
      expect(tracker.isTracking('s1')).toBe(false)

      // Output emitted after done never leaks into a later call.
      emit('s1', 'ghost')
      const after = await run()
      expect(after.output).toBe('')
    })

    it('reports done when the card has left "In progress" even without an exit', async () => {
      const { run, setStatus } = setup()
      await run()
      setStatus('in_review')
      const result = await run()
      expect(result).toMatchObject({ isDone: true, status: 'in_review' })
    })

    it('never leaks another session\'s output', async () => {
      const { run, emit } = setup()
      await run() // tracks s1 only

      emit('s2', 'other card noise')
      emit('s1', 'my output')
      const result = await run()
      expect(result.output).toBe('my output')
    })

    it('returns done with a null session for a card that never started', async () => {
      const { run } = setup('todo', null)
      const result = await run()
      expect(result).toMatchObject({ sessionId: null, isDone: true, output: '' })
    })

    it('throws when the card does not exist', async () => {
      const events = new CockpitEvents()
      const { ctx } = makeContext({ cardOutput: new CardOutputTracker(events) })
      await expect(
        toolNamed(ctx, 'subscribe_card_output').run({ projectId: 'p1', cardId: 'ghost' }),
      ).rejects.toThrow()
    })

    it('rejects invalid input (missing cardId)', async () => {
      const { ctx } = makeContext()
      await expect(toolNamed(ctx, 'subscribe_card_output').run({ projectId: 'p1' })).rejects.toThrow()
    })
  })

  // --- Faz 3b: git tools ---------------------------------------------------

  describe('get_git_status', () => {
    it('returns live status and exact HEAD evidence from the same project', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'get_git_status').run({ projectId: 'p1' })
      expect(calls.gitStatus).toEqual(['p1'])
      expect(calls.gitHead).toEqual(['p1'])
      expect(result).toEqual({ ...GIT_SNAPSHOT, headCommit: GIT_HEAD })
    })

    it('rejects invalid input (missing projectId)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'get_git_status').run({})).rejects.toThrow()
      expect(calls.gitStatus).toEqual([])
      expect(calls.gitHead).toEqual([])
    })
  })

  describe('get_git_diff_stat', () => {
    it('validates and forwards projectId + optional dir', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'get_git_diff_stat').run({ projectId: 'p1', dir: '/repo/wt' })
      expect(calls.diffStat).toEqual([{ projectId: 'p1', opts: { dir: '/repo/wt' } }])
      expect(result).toEqual(DIFF_STAT)
    })

    it('rejects a dir over the length cap', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'get_git_diff_stat').run({ projectId: 'p1', dir: 'x'.repeat(1025) }),
      ).rejects.toThrow()
      expect(calls.diffStat).toEqual([])
    })
  })

  // --- Faz 3b: checks (allowlist-only) + screenshot ------------------------

  describe('run_checks', () => {
    it('validates and forwards an allowlisted check', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'run_checks').run({ projectId: 'p1', check: 'typecheck' })
      expect(calls.checks).toEqual([{ projectId: 'p1', check: 'typecheck' }])
      expect(result).toMatchObject({ check: 'typecheck', exitCode: 0 })
    })

    it('accepts each of the three allowlisted checks', async () => {
      for (const check of ['test', 'typecheck', 'lint'] as const) {
        const { ctx, calls } = makeContext()
        await toolNamed(ctx, 'run_checks').run({ projectId: 'p1', check })
        expect(calls.checks).toEqual([{ projectId: 'p1', check }])
      }
    })

    it('SECURITY: rejects an invalid check BEFORE any process can spawn', async () => {
      // Wire a REAL checks service with a spy child-process runner. The enum is
      // parsed at the tool boundary, so a bad value must throw before the runner
      // (the thing that would spawn npm) is ever touched.
      const spawnSpy = vi.fn(async () => ({ stdout: '', stderr: '', code: 0, timedOut: false }))
      const projects = stubProjects('/repo')
      const checks = new HermesChecksService(projects, spawnSpy)
      const { ctx } = makeContext({ checks })

      await expect(
        toolNamed(ctx, 'run_checks').run({ projectId: 'p1', check: 'deploy' }),
      ).rejects.toThrow()
      await expect(
        toolNamed(ctx, 'run_checks').run({ projectId: 'p1', check: 'npm test && rm -rf /' }),
      ).rejects.toThrow()

      // The allowlist held: no child process was ever spawned for a bad value.
      expect(spawnSpy).not.toHaveBeenCalled()
    })

    it('rejects a missing check', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'run_checks').run({ projectId: 'p1' })).rejects.toThrow()
      expect(calls.checks).toEqual([])
    })
  })

  describe('run_checks — HermesChecksService allowlist mapping', () => {
    it('maps each enum to exactly its fixed npm command and nothing else', async () => {
      const seen: string[][] = []
      const runner = vi.fn(async (_bin: string, args: readonly string[]) => {
        seen.push([...args])
        return { stdout: 'out', stderr: '', code: 0, timedOut: false }
      })
      const projects = stubProjects('/repo')
      const svc = new HermesChecksService(projects, runner)

      await svc.run('p1', 'test')
      await svc.run('p1', 'typecheck')
      await svc.run('p1', 'lint')

      expect(seen).toEqual([['test'], ['run', 'typecheck'], ['run', 'lint']])
      // Every invocation targeted the npm binary — never an arbitrary command.
      for (const call of runner.mock.calls) {
        expect(call[0]).toMatch(/(^|\/)npm$/)
      }
    })

    it('reports a non-zero exit code without throwing (a failing check is normal)', async () => {
      const runner = vi.fn(async () => ({ stdout: 'FAIL', stderr: 'boom', code: 1, timedOut: false }))
      const projects = stubProjects('/repo')
      const svc = new HermesChecksService(projects, runner)
      const result = await svc.run('p1', 'test')
      expect(result).toMatchObject({ exitCode: 1, timedOut: false, stdout: 'FAIL' })
    })

    it('flags a timeout with a null exit code and a killed note', async () => {
      const runner = vi.fn(async () => ({ stdout: '', stderr: '', code: null, timedOut: true }))
      const projects = stubProjects('/repo')
      const svc = new HermesChecksService(projects, runner)
      const result = await svc.run('p1', 'test')
      expect(result.exitCode).toBeNull()
      expect(result.timedOut).toBe(true)
      expect(result.stderr).toContain('timed out')
    })
  })

  describe('take_app_screenshot', () => {
    it('validates and forwards to screenshot.capture', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'take_app_screenshot').run({ projectId: 'p1', label: 'dashboard' })
      expect(calls.screenshot).toEqual([{ projectId: 'p1', req: { label: 'dashboard', url: undefined, waitMs: undefined } }])
      expect(result).toMatchObject({ path: '/tmp/dashboard.png', rebuilt: true })
    })

    it('accepts a loopback url and a wait', async () => {
      const { ctx, calls } = makeContext()
      await toolNamed(ctx, 'take_app_screenshot').run({
        projectId: 'p1',
        label: 'git',
        url: 'http://localhost:3000/#git',
        waitMs: 800,
      })
      expect(calls.screenshot).toEqual([
        { projectId: 'p1', req: { label: 'git', url: 'http://localhost:3000/#git', waitMs: 800 } },
      ])
    })

    it('rejects a non-loopback url (no arbitrary external pages)', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'take_app_screenshot').run({ projectId: 'p1', label: 'x', url: 'https://evil.example.com' }),
      ).rejects.toThrow()
      expect(calls.screenshot).toEqual([])
    })

    it('rejects a label with path/shell characters', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'take_app_screenshot').run({ projectId: 'p1', label: '../../etc/passwd' }),
      ).rejects.toThrow()
      expect(calls.screenshot).toEqual([])
    })
  })

  // --- Faz 3b: memory ------------------------------------------------------

  describe('read_memory_recent', () => {
    it('returns actual note content, not only the summary graph', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'read_memory_recent').run({ projectId: 'p1' })) as {
        notes: { name: string; content: string }[]
      }
      expect(calls.memoryList).toEqual(['p1'])
      expect(calls.memoryListDocs).toEqual(['p1'])
      expect(result.notes[0].content).toContain('molten obsidian and copper accents')
    })

    it('returns only bounded positive matches when Hermes supplies a task query', async () => {
      const base = makeContext()
      const memory: HermesToolContext['memory'] = {
        list: () => MEMORY_SNAPSHOT,
        listDocs: () => [
          {
            name: 'landing-page-direction',
            content: 'Landing pages use molten obsidian and copper accents.',
            updatedAt: 't1',
          },
          {
            name: 'billing-window',
            content: 'Billing windows reset at midnight.',
            updatedAt: 't2',
          },
        ],
        write: base.ctx.memory.write,
      }
      const { ctx } = makeContext({ memory })

      const result = (await toolNamed(ctx, 'read_memory_recent').run({
        projectId: 'p1',
        query: 'redesign the landing page',
        limit: 2,
      })) as { notes: { name: string; content: string }[] }

      expect(result.notes.map((note) => note.name)).toEqual(['landing-page-direction'])
      expect(result.notes[0].content).toContain('molten obsidian')
    })

    it('rejects invalid input (missing projectId)', async () => {
      const { ctx } = makeContext()
      await expect(toolNamed(ctx, 'read_memory_recent').run({})).rejects.toThrow()
    })
  })

  describe('write_memory_summary — charter write-gate (Faz C)', () => {
    const justification = {
      sevenDayScenario: 'when someone re-reads how the router placement decision was reached',
      dedupChecked: 'no-overlap' as const,
      evidence: 'the session where we moved the router into shared',
    }

    it('accepts a justified, deduped, secret-free write and forwards it', async () => {
      const { ctx, calls } = makeContext()
      const result = await toolNamed(ctx, 'write_memory_summary').run({
        projectId: 'p1',
        name: 'run-summary',
        content: 'The router lives in shared so both bridges classify identically.',
        justification,
      })
      expect(calls.memoryWrite).toEqual([
        { projectId: 'p1', name: 'run-summary', content: 'The router lives in shared so both bridges classify identically.' },
      ])
      expect(result).toMatchObject({ name: 'run-summary' })
      // acceptance is audited (stats only)
      expect(calls.auditRecord).toHaveLength(1)
      expect(calls.auditRecord[0]).toMatchObject({ actionType: 'memory_write_gate', payload: { verdict: 'accept' } })
    })

    it('routes a junk write ("might be useful") to the review queue instead of writing it', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'write_memory_summary').run({
        projectId: 'p1',
        name: 'stray-thought',
        content: 'random note body',
        justification: { ...justification, sevenDayScenario: 'might be useful someday maybe' },
      })) as { queued: boolean; verdict: string }
      // never written directly...
      expect(calls.memoryWrite).toEqual([])
      // ...queued into the SAME review mechanism the distiller uses
      expect(calls.memoryReviewCreate).toHaveLength(1)
      expect(calls.memoryReviewCreate[0]).toMatchObject({ brain: projectBrain('p1'), slug: 'stray-thought' })
      expect(result).toMatchObject({ queued: true, verdict: 'review' })
    })

    it('routes an unjustified write (no justification at all) to review, never lost', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'write_memory_summary').run({
        projectId: 'p1',
        name: 'no-justification',
        content: 'a fact with no justification attached',
      })) as { queued: boolean }
      expect(calls.memoryWrite).toEqual([])
      expect(calls.memoryReviewCreate).toHaveLength(1)
      expect(result.queued).toBe(true)
    })

    it('rejects secret-shaped content with a clear error citing the charter', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'write_memory_summary').run({
          projectId: 'p1',
          name: 'leaky-note',
          content: 'the key is sk-or-v1-0123456789abcdefghijklmnop keep it safe',
          justification,
        }),
      ).rejects.toThrow(/MEMORY-CHARTER/)
      // nothing written, nothing queued — a secret never lands anywhere
      expect(calls.memoryWrite).toEqual([])
      expect(calls.memoryReviewCreate).toEqual([])
      expect(calls.auditRecord[0]).toMatchObject({ payload: { verdict: 'reject' } })
    })

    it('rejects a name over the 120 char cap at the boundary', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'write_memory_summary').run({ projectId: 'p1', name: 'x'.repeat(121), content: 'c', justification }),
      ).rejects.toThrow()
      expect(calls.memoryWrite).toEqual([])
    })

    it('rejects content over the 500,000 char cap at the boundary', async () => {
      const { ctx } = makeContext()
      await expect(
        toolNamed(ctx, 'write_memory_summary').run({ projectId: 'p1', name: 'n', content: 'x'.repeat(500_001), justification }),
      ).rejects.toThrow()
    })
  })

  describe('get_pending_memory_reviews', () => {
    it('concatenates the project brain and the global Baz brain queues', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'get_pending_memory_reviews').run({ projectId: 'p1' })) as ReviewItem[]
      expect(calls.listPending).toEqual([projectBrain('p1'), BAZ_GLOBAL_BRAIN])
      expect(result).toHaveLength(2)
      expect(result.map((r) => r.brain)).toEqual([projectBrain('p1'), BAZ_GLOBAL_BRAIN])
    })

    it('rejects invalid input (missing projectId)', async () => {
      const { ctx, calls } = makeContext()
      await expect(toolNamed(ctx, 'get_pending_memory_reviews').run({})).rejects.toThrow()
      expect(calls.listPending).toEqual([])
    })
  })

  describe('resolve_memory_review', () => {
    it('resolves then returns the project brain pending queue', async () => {
      const { ctx, calls } = makeContext()
      const result = (await toolNamed(ctx, 'resolve_memory_review').run({
        projectId: 'p1',
        reviewId: 'r1',
        decision: 'accept',
      })) as ReviewItem[]
      expect(calls.resolveReview).toEqual([
        { projectId: 'p1', reviewId: 'r1', decision: 'accept', editedContent: undefined },
      ])
      // Only the project brain's remaining queue is re-read (matches the IPC handler).
      expect(calls.listPending).toEqual([projectBrain('p1')])
      expect(result).toHaveLength(1)
    })

    it('forwards editedContent on an edit decision', async () => {
      const { ctx, calls } = makeContext()
      await toolNamed(ctx, 'resolve_memory_review').run({
        projectId: 'p1',
        reviewId: 'r1',
        decision: 'edit',
        editedContent: 'fixed up',
      })
      expect(calls.resolveReview).toEqual([
        { projectId: 'p1', reviewId: 'r1', decision: 'edit', editedContent: 'fixed up' },
      ])
    })

    it('rejects an unknown decision before resolving', async () => {
      const { ctx, calls } = makeContext()
      await expect(
        toolNamed(ctx, 'resolve_memory_review').run({ projectId: 'p1', reviewId: 'r1', decision: 'nuke' }),
      ).rejects.toThrow()
      expect(calls.resolveReview).toEqual([])
    })
  })
})
