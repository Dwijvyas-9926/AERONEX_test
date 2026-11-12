import { create } from "zustand";

/* Which of the app-wide overlays is open. Only one at a time. */
interface UiState {
  overlay: "help" | "search" | null;
  open: (o: "help" | "search") => void;
  toggle: (o: "help" | "search") => void;
  close: () => void;
}

export const useUi = create<UiState>((set) => ({
  overlay: null,
  open: (overlay) => set({ overlay }),
  toggle: (o) => set((s) => ({ overlay: s.overlay === o ? null : o })),
  close: () => set({ overlay: null }),
}));
