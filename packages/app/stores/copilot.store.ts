import { create } from 'zustand'

/**
 * Copilot slide-over store (phase 6). The Copilot is a panel that **travels with the
 * user** over any screen (board/scorecard/…), not a route — so its open state and the
 * active conversation live in a module-singleton store that persists across navigation
 * (the panel is mounted once, above the per-screen shell). Not persisted to storage:
 * the thread itself is server-persisted; this only holds the live open/active state.
 */
interface CopilotState {
  open: boolean
  /** The active conversation id (loaded on open; updated as turns flow). */
  conversationId: string | null
  openCopilot: () => void
  closeCopilot: () => void
  toggleCopilot: () => void
  setConversation: (id: string | null) => void
}

const useCopilotStore = create<CopilotState>((set) => ({
  open: false,
  conversationId: null,
  openCopilot: () => set({ open: true }),
  closeCopilot: () => set({ open: false }),
  toggleCopilot: () => set((s) => ({ open: !s.open })),
  setConversation: (conversationId) => set({ conversationId }),
}))

// Granular selectors (each returns a stable value/function ref) — never an object
// literal (that re-creates each render → useSyncExternalStore infinite loop).
/** Whether the Copilot panel is open. */
export const useCopilotOpen = () => useCopilotStore((s) => s.open)
/** The active conversation id (null = none loaded yet). */
export const useCopilotConversationId = () => useCopilotStore((s) => s.conversationId)
/** Toggle the panel (the FAB trigger). */
export const useToggleCopilot = () => useCopilotStore((s) => s.toggleCopilot)
/** Open the panel. */
export const useOpenCopilot = () => useCopilotStore((s) => s.openCopilot)
/** Close the panel. */
export const useCloseCopilot = () => useCopilotStore((s) => s.closeCopilot)
/** Set the active conversation id. */
export const useSetCopilotConversation = () => useCopilotStore((s) => s.setConversation)
