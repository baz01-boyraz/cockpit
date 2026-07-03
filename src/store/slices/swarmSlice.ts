import { cockpit } from '../../lib/cockpit'
import type { SliceCreator, SwarmSlice } from './types'

/**
 * Swarm board slice (VISION 6.1.5). Every mutation on `cockpit().swarm`
 * returns the fresh board, so each action simply stores what came back —
 * there is no optimistic state to reconcile. Errors are NOT caught here:
 * the panel surfaces them inline (memnotice pattern) and refreshes.
 */
export const createSwarmSlice: SliceCreator<SwarmSlice> = (set) => ({
  board: null,
  boardProjectId: null,
  boardLoading: false,

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
    const board = await cockpit().swarm.startCard(input)
    set({ board, boardProjectId: input.projectId })
  },

  parkCard: async (input) => {
    const board = await cockpit().swarm.parkCard(input)
    set({ board, boardProjectId: input.projectId })
  },
})
