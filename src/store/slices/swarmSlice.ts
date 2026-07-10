import { cockpit } from '../../lib/cockpit'
import type { SliceCreator, SwarmSlice } from './types'

/**
 * Swarm board slice (VISION 6.1.5). Every mutation on `cockpit().swarm`
 * returns the fresh board, so each action simply stores what came back —
 * there is no optimistic state to reconcile. Errors are NOT caught here:
 * the panel surfaces them inline (memnotice pattern) and refreshes.
 */
export const createSwarmSlice: SliceCreator<SwarmSlice> = (set, get) => ({
  board: null,
  boardProjectId: null,
  boardLoading: false,
  agents: [],
  agentsProjectId: null,

  refreshBoard: async (projectId) => {
    set({ boardLoading: true })
    try {
      const board = await cockpit().swarm.board(projectId)
      set({ board, boardProjectId: projectId, boardLoading: false })
    } catch (err: unknown) {
      set({ boardLoading: false })
      throw err
    }
  },

  // Named Agents roster (.claude/agents) — fetched once per project; the
  // definitions only change on disk, so a project switch is the refresh point.
  refreshAgents: async (projectId) => {
    if (get().agentsProjectId === projectId) return
    const agents = await cockpit().swarm.agents(projectId)
    set({ agents, agentsProjectId: projectId })
  },

  createCard: async (input) => {
    const board = await cockpit().swarm.createCard(input)
    set({ board, boardProjectId: input.projectId })
  },

  updateCard: async (input) => {
    const board = await cockpit().swarm.updateCard(input)
    set({ board, boardProjectId: input.projectId })
  },

  moveCard: async (input) => {
    const board = await cockpit().swarm.moveCard(input)
    set({ board, boardProjectId: input.projectId })
  },

  removeCard: async (input) => {
    const board = await cockpit().swarm.removeCard(input)
    set({ board, boardProjectId: input.projectId })
  },

  startCard: async (input) => {
    const result = await cockpit().swarm.startCard(input)
    // A gated start never moved the card — leave the board as-is and let the
    // panel surface the convene/skip prompt. A real start returns the fresh board.
    if (!result.gated) set({ board: result.board, boardProjectId: input.projectId })
    return result
  },

  parkCard: async (input) => {
    const board = await cockpit().swarm.parkCard(input)
    set({ board, boardProjectId: input.projectId })
  },
})
