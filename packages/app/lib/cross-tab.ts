import { useEffect } from 'react'
import { queryClient } from './query-client'

/**
 * Cross-tab query invalidation over `BroadcastChannel`. The dev simulator runs in its own tab and
 * only **sets a condition in the data** (no re-solve); without this the Board tab keeps showing the
 * stale conditions until a manual refresh. A simulator action broadcasts the affected query
 * namespaces; every other tab invalidates them, so the new condition (line-down, demand change,
 * material gate, operator factor, wear actuals) appears without a refresh.
 *
 * Same-origin only (the demo's two tabs share an origin). Absent on React Native / during SSR → the
 * channel is null and every export is a no-op there.
 */
/**
 * ── KILL SWITCH ──────────────────────────────────────────────────────────────────────────────────
 * Master on/off for cross-tab condition sync. **To disable the feature entirely, set this to `false`**
 * — it gates BOTH ends, so nothing broadcasts and no tab listens (every export becomes a no-op). It is
 * referenced at the listener mount in `admin-shell.tsx` (`useConditionSync(CROSS_TAB_SYNC_ENABLED)`)
 * and inside `broadcastConditionChange`. Grep `CROSS_TAB_SYNC_ENABLED` to find both call sites.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────
 */
export const CROSS_TAB_SYNC_ENABLED = true

const CHANNEL = 'perduraflow:conditions'

/** Query-key prefixes a simulator condition can touch. Invalidating a prefix refetches every query
 *  under it (work-list, scorecard, baseline, variance, demand, downtime, predictions, …). */
export const CONDITION_NAMESPACES = ['scheduling', 'master-data', 'learning'] as const

interface ConditionMessage {
  type: 'invalidate'
  namespaces: readonly string[]
}

// One channel object per tab (module singleton). A `BroadcastChannel` never delivers a message back
// to the object that posted it, so the tab that broadcasts won't re-invalidate itself.
const channel: BroadcastChannel | null =
  typeof globalThis !== 'undefined' && 'BroadcastChannel' in globalThis ? new BroadcastChannel(CHANNEL) : null

/** Tell other tabs to refetch the given query namespaces (default: every condition surface). Call
 *  after a simulator condition mutation succeeds. No-op when {@link CROSS_TAB_SYNC_ENABLED} is false. */
export function broadcastConditionChange(namespaces: readonly string[] = CONDITION_NAMESPACES): void {
  if (!CROSS_TAB_SYNC_ENABLED) return
  channel?.postMessage({ type: 'invalidate', namespaces })
}

/** Listen for cross-tab condition changes and invalidate the named namespaces. Mount ONCE per tab
 *  (the app shell) so the Board tab reflects a simulator change without a refresh. Pass the
 *  {@link CROSS_TAB_SYNC_ENABLED} flag from the call site; the hook no-ops when it's false. */
export function useConditionSync(enabled: boolean = CROSS_TAB_SYNC_ENABLED): void {
  useEffect(() => {
    if (!enabled || !channel) return
    const onMessage = (e: MessageEvent<ConditionMessage>) => {
      if (e.data?.type !== 'invalidate') return
      for (const ns of e.data.namespaces) queryClient.invalidateQueries({ queryKey: [ns] })
    }
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [enabled])
}
