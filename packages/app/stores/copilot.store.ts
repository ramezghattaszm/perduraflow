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
  /** A pre-seeded composer message (set when a screen opens the Copilot to ask a specific question,
   *  e.g. "Evaluate options" on an at-risk row). The panel reads it once into the input, then clears. */
  draft: string | null
  /** A pre-computed what-if result the conversation should START from — the "Evaluate options" door
   *  pre-runs the deterministic at_risk_remediation so the Copilot narrates the SAME root-matched set
   *  (never re-deriving the root, which caused the wear-misroute). Merged into the first turn's screen
   *  context as `activeResultId`, then cleared. */
  seededResultId: string | null
  openCopilot: () => void
  /** Open the panel with the composer pre-filled (the planner reviews, then sends), optionally anchored
   *  to a pre-computed what-if result the conversation should start from. */
  openCopilotWith: (prompt: string, seededResultId?: string | null) => void
  consumeDraft: () => void
  /** Read + clear the seeded result id (called once at the first send). */
  consumeSeededResultId: () => string | null
  closeCopilot: () => void
  toggleCopilot: () => void
  setConversation: (id: string | null) => void
}

const useCopilotStore = create<CopilotState>((set, get) => ({
  open: false,
  conversationId: null,
  draft: null,
  seededResultId: null,
  openCopilot: () => set({ open: true }),
  openCopilotWith: (draft, seededResultId = null) => set({ open: true, draft, seededResultId }),
  consumeDraft: () => set({ draft: null }),
  consumeSeededResultId: () => {
    const id = get().seededResultId
    if (id) set({ seededResultId: null })
    return id
  },
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
/** Open the panel with the composer pre-seeded with a prompt. */
export const useOpenCopilotWith = () => useCopilotStore((s) => s.openCopilotWith)
/** The pending pre-seed draft (null = none). */
export const useCopilotDraft = () => useCopilotStore((s) => s.draft)
/** Clear the pending draft (call after reading it into the composer). */
export const useConsumeCopilotDraft = () => useCopilotStore((s) => s.consumeDraft)
/** Read + clear the seeded what-if result id (call once at the first send to anchor the conversation). */
export const useConsumeSeededResultId = () => useCopilotStore((s) => s.consumeSeededResultId)
/** Close the panel. */
export const useCloseCopilot = () => useCopilotStore((s) => s.closeCopilot)
/** Set the active conversation id. */
export const useSetCopilotConversation = () => useCopilotStore((s) => s.setConversation)
