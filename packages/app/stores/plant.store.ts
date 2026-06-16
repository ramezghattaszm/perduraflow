import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { kvStorage } from '../lib/kv-storage'

/**
 * Selected-plant store (UI-ARCHITECTURE.md §6) — the planner's current plant,
 * **persisted** across boards (Board, Scorecard, Workforce, simulator) and
 * sessions via the cross-platform `kvStorage` (localStorage on web,
 * AsyncStorage on native). On load the value is validated against the user's
 * visible plants and falls back to a default if stale — see {@link usePlantSelection}.
 */
interface PlantState {
  selectedPlantId: string | null
  setSelectedPlant: (id: string | null) => void
}

const usePlantStore = create<PlantState>()(
  persist(
    (set) => ({
      selectedPlantId: null,
      setSelectedPlant: (selectedPlantId) => set({ selectedPlantId }),
    }),
    { name: 'perduraflow-plant', storage: createJSONStorage(() => kvStorage) },
  ),
)

export { usePlantStore }

/** The persisted selected plant id (may be stale until validated). Granular selector (§6). */
export const useSelectedPlantId = () => usePlantStore((s) => s.selectedPlantId)
/** Setter for the selected plant (persisted). */
export const useSetSelectedPlant = () => usePlantStore((s) => s.setSelectedPlant)
