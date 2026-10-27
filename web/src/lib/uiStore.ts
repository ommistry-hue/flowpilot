import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UiState {
  sidebarCollapsed: boolean
  paletteOpen: boolean
  /** The designer's activity panel (not the command palette). */
  activitiesCollapsed: boolean
  toggleSidebar: () => void
  toggleActivities: () => void
  setSidebarCollapsed: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      paletteOpen: false,
      activitiesCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      setPaletteOpen: (v) => set({ paletteOpen: v }),
      toggleActivities: () => set((s) => ({ activitiesCollapsed: !s.activitiesCollapsed })),
    }),
    { name: 'fp-ui', partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, activitiesCollapsed: s.activitiesCollapsed }) },
  ),
)
