import type { LatenessChainDto } from '@perduraflow/contracts'

/**
 * Render the computed causal lateness chain (D-late) into planner-readable copy — shared by the board
 * bar panel (full, expandable), the exception queue, and the Scorecard (concise). The chain itself is
 * a grounded engine fact; these helpers only translate it to text (i18n). Pure: same chain → same copy.
 */

type TFn = (key: string, opts?: Record<string, unknown>) => string

/** The root-cause label, e.g. "PV-22 material" / "due before it could start". */
export function latenessRootLabel(chain: LatenessChainDto, t: TFn): string {
  const rootHop = chain.hops[chain.hops.length - 1]
  if (chain.root === 'material') {
    const component = rootHop?.detail
    return component ? t('lateness.rootMaterial', { component }) : t('lateness.rootMaterialNoComp')
  }
  if (chain.root === 'resource_downtime') {
    // Kind drives the copy nuance (line-down vs maintenance); the window reason (detail) refines it.
    const base = rootHop?.downtimeKind === 'maintenance' ? t('lateness.rootMaintenance') : t('lateness.rootLineDown')
    return rootHop?.detail ? t('lateness.rootDowntimeReason', { base, reason: rootHop.detail }) : base
  }
  // rootWorking_window / rootCapacity / rootDue_before_start
  return t(`lateness.root${chain.root.charAt(0).toUpperCase()}${chain.root.slice(1)}`)
}

/** The planner LEVER for a root cause — what to actually do (re-sequence won't always help). */
export function latenessLever(chain: LatenessChainDto, t: TFn): string {
  return t(`lateness.lever.${chain.root}`)
}

/**
 * Concise one-liner: the cause + the immediate blocker (if any) + the LEVER. Two shapes:
 *  - **tight** — no blocker, or the immediate blocker IS the root-cause order (a single-source
 *    cascade): "{cause} · held by {blocker} — {lever}".
 *  - **divergent** — the immediate blocker is a DIFFERENT, on-time order (multi-order resource
 *    congestion): don't glue them — "{immediate}; root cause: {cause} ({rootOrder}) — {lever}", so a
 *    queued-behind blocker is never mislabeled as the material/root holder.
 * The full hop-by-hop chain ({@link latenessLines}) stays trace-only (no lever).
 */
export function latenessSummary(chain: LatenessChainDto, t: TFn): string {
  const cause = latenessRootLabel(chain, t)
  const lever = latenessLever(chain, t)
  const hops = chain.hops
  const lateOp = hops[0]!
  const root = hops[hops.length - 1]!
  // hops[0] is the late op; hops[1] (if present) is what immediately held it.
  const blocker = hops.length > 1 ? hops[1]! : null
  if (!blocker)
    return t('lateness.withLever', { base: t('lateness.conciseSelf', { cause }), lever })

  // Tight: the immediate blocker is the same order the root cause sits on → the cause IS the holder.
  if (blocker.demandLineId === root.demandLineId) {
    const base = t('lateness.concise', {
      cause,
      blocker: t('lateness.heldBy', { order: blocker.demandLineId, opSeq: blocker.opSeq }),
    })
    return t('lateness.withLever', { base, lever })
  }

  // Divergent: the late op is queued behind a different (on-time) order; the root is elsewhere.
  const immediate =
    lateOp.kind === 'predecessor'
      ? t('lateness.behindPredecessor', { opSeq: blocker.opSeq })
      : t('lateness.behindResource', {
          blocker: blocker.demandLineId,
          resource: blocker.resourceName,
        })
  return t('lateness.divergent', { immediate, cause, rootOrder: root.demandLineId, lever })
}

/** Full chain, one line per hop (late op → blocker → … → root). For the board panel expander + Copilot. */
export function latenessLines(chain: LatenessChainDto, t: TFn): string[] {
  const lines = chain.hops.map((h, i) => {
    const isRoot = i === chain.hops.length - 1
    if (!isRoot && h.kind === 'resource')
      return t('lateness.hopResource', {
        order: h.demandLineId,
        opSeq: h.opSeq,
        resource: h.resourceName,
      })
    if (!isRoot && h.kind === 'predecessor')
      return t('lateness.hopPredecessor', {
        order: h.demandLineId,
        opSeq: h.opSeq,
        resource: h.resourceName,
      })
    return t('lateness.hopRoot', {
      order: h.demandLineId,
      opSeq: h.opSeq,
      resource: h.resourceName,
      cause: latenessRootLabel(chain, t),
    })
  })
  if (chain.truncated) lines.push(t('lateness.truncated'))
  return lines
}
