import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type MotionPref = "system" | "reduced" | "full";
export type GraphicsPreset = "low" | "medium" | "high" | "ultra";
export type Units = "metric" | "imperial";

interface SettingsState {
  motion: MotionPref;
  graphics: GraphicsPreset;
  units: Units;
  sidebarCollapsed: boolean;
  /** BYOK: the user's own Anthropic API key for the Ask the Doctor chat. Stored only in this browser. */
  aiKey: string;
  aiModel: string;
  set: <K extends keyof Omit<SettingsState, "set">>(k: K, v: SettingsState[K]) => void;
}

export const DEFAULT_AI_MODEL = "claude-3-5-sonnet-latest";

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      motion: "system",
      graphics: "high",
      units: "metric",
      sidebarCollapsed: false,
      aiKey: "",
      aiModel: DEFAULT_AI_MODEL,
      set: (k, v) => set({ [k]: v } as Partial<SettingsState>),
    }),
    { name: "avion.settings.v1", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

/** Resolved motion preference, honouring the OS setting when set to "system". */
export function prefersReducedMotion(pref: MotionPref): boolean {
  if (pref === "reduced") return true;
  if (pref === "full") return false;
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export const GRAPHICS: Record<GraphicsPreset, { dpr: [number, number]; shadows: boolean; label: string; detail: string }> = {
  low: { dpr: [0.75, 1], shadows: false, label: "Low", detail: "Reduced resolution, no shadows. For integrated graphics." },
  medium: { dpr: [1, 1.25], shadows: false, label: "Medium", detail: "Native resolution, no shadows." },
  high: { dpr: [1, 1.5], shadows: true, label: "High", detail: "Soft shadows and higher resolution." },
  ultra: { dpr: [1, 2], shadows: true, label: "Ultra", detail: "Full device resolution. Needs a discrete GPU." },
};
