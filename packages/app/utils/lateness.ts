import type { LatenessChainDto } from '@perduraflow/contracts'

/**
 * Render the computed causal lateness chain (D-late) into planner-readable copy — shared by the board
 * bar panel (full, expandable), the exception queue, and the Scorecard (concise). The chain itself is
 * a grounded engine fact; these helpers only translate it to text (i18n). Pure: same chain → same copy.
 */

type TFn = (key: string, opts?: Record<string, unknown>) => string

/** The root-cause label, e.g. "PV-22 material" / "due before it could start". */
export function latenessRootLabel(chain: LatenessChainDto, t: TFn): string {
  if (chain.root === 'material') {
    const component = chain.hops[chain.hops.length - 1]?.detail
    return component ? t('lateness.rootMaterial', { component }) : t('lateness.rootMaterialNoComp')
  }
  // rootWorking_window / rootCapacity / rootDue_before_start
  return t(`lateness.root${chain.root.charAt(0).toUpperCase()}${chain.root.slice(1)}`)
}

/** Concise one-liner: root cause + the immediate blocker (if any). For the queue / scorecard rows. */
export function latenessSummary(chain: LatenessChainDto, t: TFn): string {
  const cause = latenessRootLabel(chain, t)
  // hops[0] is the late op itself; hops[1] (if present) is the op that held it.
  const blocker = chain.hops.length > 1 ? chain.hops[1]! : null
  return blocker
    ? t('lateness.concise', { cause, blocker: t('lateness.heldBy', { order: blocker.demandLineId, opSeq: blocker.opSeq }) })
    : t('lateness.conciseSelf', { cause })
}

/** Full chain, one line per hop (late op → blocker → … → root). For the board panel expander + Copilot. */
export function latenessLines(chain: LatenessChainDto, t: TFn): string[] {
  const lines = chain.hops.map((h, i) => {
    const isRoot = i === chain.hops.length - 1
    if (!isRoot && h.kind === 'resource') return t('lateness.hopResource', { order: h.demandLineId, opSeq: h.opSeq, resource: h.resourceName })
    if (!isRoot && h.kind === 'predecessor') return t('lateness.hopPredecessor', { order: h.demandLineId, opSeq: h.opSeq, resource: h.resourceName })
    return t('lateness.hopRoot', { order: h.demandLineId, opSeq: h.opSeq, resource: h.resourceName, cause: latenessRootLabel(chain, t) })
  })
  if (chain.truncated) lines.push(t('lateness.truncated'))
  return lines
}
