import { useEffect } from 'react'
import type { PlantDto } from '@perduraflow/contracts'
import { useSelectedPlantId, useSetSelectedPlant } from '../stores/plant.store'

/**
 * Shared plant selection for every board (Board, Scorecard, Workforce, simulator).
 * Reads the **persisted** selected plant (plant.store), **validates** it against the
 * user's currently visible `plants`, and **falls back** to the first plant when the
 * stored id is null or stale (e.g. a plant the user can no longer see). Returns the
 * resolved id + the persisted setter for the selector's `onChange`.
 *
 * @example
 * const { plantId, setPlant } = usePlantSelection(plants)
 */
export function usePlantSelection(plants: PlantDto[]): {
  plantId: string | null
  setPlant: (id: string | null) => void
} {
  const plantId = useSelectedPlantId()
  const setPlant = useSetSelectedPlant()

  useEffect(() => {
    if (plants.length === 0) return
    if (!plantId || !plants.some((p) => p.id === plantId)) {
      setPlant(plants[0]!.id)
    }
  }, [plants, plantId, setPlant])

  // While an invalid/stale id is being repaired, present the valid default so
  // dependent queries don't fire against a plant the user can't see.
  const valid = plantId && plants.some((p) => p.id === plantId) ? plantId : (plants[0]?.id ?? null)
  return { plantId: valid, setPlant }
}
