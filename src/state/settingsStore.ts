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

export const DEFAULT_AI_MODEL = "claude-sonnet-5-5";

/** Models offered in Settings; any other id the account has can be typed in. */
export const AI_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"];

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
    {
      name: "avion.settings.v1",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      /*
        The first default was a model that has since been retired, so anyone
        who never touched the setting was left with a chat that answered every
        question with "model not available". A saved value that is still one
        of the old defaults moves to the current one; a model the user typed
        in themselves is theirs and is kept.
      */
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        if (!p.aiModel || /^claude-3-/.test(p.aiModel)) p.aiModel = DEFAULT_AI_MODEL;
        return p as SettingsState;
      },
    },
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
