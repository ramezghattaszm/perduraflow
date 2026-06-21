import { create } from 'zustand'
import type { ScreenContext } from '@perduraflow/contracts'

/**
 * Screen-context store (Pass B). The Copilot is a global panel above the screens, so the active
 * screen **publishes** what the planner is looking at here and the Copilot **reads** it at send
 * time to resolve deictic references ("this", "here", "the current option"). A snapshot only —
 * a default for deictic refs, never a filter; a named entity always overrides it server-side.
 *
 * Read it **imperatively** at send time via {@link getScreenContext} so the turn carries the
 * CURRENT selection (no stale-closure race); the reactive selector is for components that need
 * to render from it. Not persisted — it mirrors live UI state.
 */
interface ScreenContextState {
  context: ScreenContext | null
  setScreenContext: (ctx: ScreenContext | null) => void
}

const useScreenContextStore = create<ScreenContextState>((set) => ({
  context: null,
  setScreenContext: (context) => set({ context }),
}))

/** Publish (or clear) the current screen context — the active screen calls this in an effect. */
export const useSetScreenContext = () => useScreenContextStore((s) => s.setScreenContext)

/** The current screen context, reactively (null = nothing published). */
export const useScreenContext = () => useScreenContextStore((s) => s.context)

/**
 * The current screen context, read **imperatively** — call this at the moment a turn is sent so
 * it captures the selection as it is right now, not a value closed over at render (no stale race).
 */
export const getScreenContext = (): ScreenContext | null => useScreenContextStore.getState().context
