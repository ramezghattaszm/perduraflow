/**
 * Resource location match (Scheduling S0a — the line dimension). A resource matches a plant, and — when a
 * `lineId` is in context — that line too. `lineId === undefined` → **plant-grain** (the pre-S0 behavior,
 * unchanged): the line clause short-circuits, so this is a pure `plantId` compare. The consumer filter
 * dimension `line` slots in here without threading a required arg through any caller.
 */
export const matchesLocation = (r: { plantId: string; lineId: string | null }, plantId: string, lineId?: string): boolean =>
  r.plantId === plantId && (lineId === undefined || r.lineId === lineId)
