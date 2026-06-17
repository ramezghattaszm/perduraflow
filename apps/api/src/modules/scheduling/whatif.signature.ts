import type { Placement } from './sequencer'

/**
 * Canonical signature of a plan's placements — the **ground truth of "same plan"**
 * for what-if option de-duplication. Captures only **op identity + resource +
 * sequence position + timing** (the placement), never score/cost/source. Identity-
 * stable order (sorted) so it's independent of emission order; **exact byte match**
 * only — two plans differing by even one placement get different signatures and both
 * survive. Pure (no Nest graph) so it's directly testable.
 */
export function placementSignature(placements: Placement[]): string {
  return placements
    .map((p) => `${p.demandLineId}|${p.routingOperationId}|${p.resourceId}|${p.sequencePosition}|${p.plannedStartMs}|${p.plannedEndMs}`)
    .sort()
    .join('␞')
}
