import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_WALL_MM, STACK_PATTERNS, kitFor, motorById, stackHeightFor } from "./catalog";
import { type FrameSpec, type Layout } from "./geometry";

export type StepId = "aircraft" | "components" | "material" | "review" | "export";

export const STEPS: { id: StepId; label: string; blurb: string }[] = [
  { id: "aircraft", label: "Aircraft", blurb: "Prop size, layout and how you fly." },
  { id: "components", label: "Components", blurb: "The motors, stack and battery you already have." },
  { id: "material", label: "Material", blurb: "What you will cut or print it from." },
  { id: "review", label: "Review", blurb: "What the studio worked out, and what it is unhappy about." },
  { id: "export", label: "Make it", blurb: "Files, hardware list and build instructions." },
];

export type ViewMode = "plan" | "solid" | "sheet";

interface StudioState {
  spec: FrameSpec;
  step: StepId;
  view: ViewMode;
  /** Explode the 3D view to show how the parts stack up. */
  exploded: boolean;
  sheetWidthMm: number;
  labelParts: boolean;
  /** Paper size for the 1:1 check sheet. */
  pageSizeId: string;
  setSpec: <K extends keyof FrameSpec>(k: K, v: FrameSpec[K]) => void;
  patchSpec: (p: Partial<FrameSpec>) => void;
  setStep: (s: StepId) => void;
  setView: (v: ViewMode) => void;
  setExploded: (v: boolean) => void;
  setSheetWidth: (v: number) => void;
  setLabelParts: (v: boolean) => void;
  setPageSize: (v: string) => void;
  reset: () => void;
}

/*
  A 5" freestyle quad on 2207 motors: the most common build in the world, and
  the one a student is most likely to be copying. Starting anywhere else means
  the first thing they see is a design they have to fix.
*/
export const DEFAULT_SPEC: FrameSpec = {
  layout: "true-x",
  propIn: 5,
  clearanceMm: 10,
  wheelbaseMm: null,
  motorId: "2207",
  motorThrustG: 1350,
  stackPattern: 30.5,
  stackBolt: 3,
  stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 },
  electronicsMassG: 120,
  construction: "bolted",
  materialId: "cf-plate",
  // null = let the studio pick from the published reference for this prop class
  fixedDimMm: null,
  plateThicknessMm: null,
  wallMm: DEFAULT_WALL_MM,
  lightenPlates: true,
  batteryMount: "bottom",
  cameraId: "micro",
  styleId: "freestyle",
  safetyFactor: 2,
};

/** The component fields a class kit fills in, as a patch for the spec. */
export function kitPatch(propIn: number): Partial<FrameSpec> {
  const kit = kitFor(propIn);
  const stack = STACK_PATTERNS.find((p) => p.pattern === kit.stackPattern) ?? STACK_PATTERNS[STACK_PATTERNS.length - 1];
  return {
    motorId: kit.motorId,
    motorThrustG: motorById(kit.motorId).thrustG,
    stackPattern: stack.pattern,
    stackBolt: stack.bolt,
    stackHeightMm: stack.heightMm,
    battery: { ...kit.battery },
    electronicsMassG: kit.electronicsMassG,
    cameraId: kit.cameraId,
  };
}

/** Is this spec still carrying the untouched kit for its propeller size? */
export function carriesKit(spec: FrameSpec): boolean {
  const kit = kitPatch(spec.propIn);
  return (
    spec.motorId === kit.motorId
    && spec.motorThrustG === kit.motorThrustG
    && spec.stackPattern === kit.stackPattern
    && spec.stackHeightMm === kit.stackHeightMm
    && spec.electronicsMassG === kit.electronicsMassG
    && spec.cameraId === kit.cameraId
    && (["l", "w", "h", "massG"] as const).every((k) => spec.battery[k] === kit.battery![k])
  );
}

export const useStudio = create<StudioState>()(
  persist(
    (set) => ({
      spec: DEFAULT_SPEC,
      step: "aircraft",
      view: "plan",
      exploded: false,
      sheetWidthMm: 300,
      labelParts: true,
      pageSizeId: "a4",
      setSpec: (k, v) => set((s) => ({ spec: { ...s.spec, [k]: v } })),
      patchSpec: (p) => set((s) => ({ spec: { ...s.spec, ...p } })),
      setStep: (step) => set({ step }),
      setView: (view) => set({ view }),
      setExploded: (exploded) => set({ exploded }),
      setSheetWidth: (sheetWidthMm) => set({ sheetWidthMm }),
      setLabelParts: (labelParts) => set({ labelParts }),
      setPageSize: (pageSizeId) => set({ pageSizeId }),
      reset: () => set({ spec: DEFAULT_SPEC, step: "aircraft" }),
    }),
    {
      name: "avion.frame-studio.v1",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      /*
        A spec saved by an older build can be missing fields the solver now
        needs, and a half-filled spec produces NaN geometry rather than an
        error. Merging over the defaults means a stale save degrades to a
        working design instead of a blank screen.
      */
      /*
        A saved spec is merged over the defaults so a record from an older
        build degrades to a working design rather than a blank screen. Two
        things that caught this out:

        - `battery` is a nested object, and a one-level spread replaces it
          wholesale. An older save missing `massG` produced NaN all the way
          through the solver and threw inside the 3D extrusion.
        - a persisted `step` that is no longer one of the five ids gave
          findIndex -1, and STEPS[-1].label threw on render.
      */
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<StudioState>;
        const spec = { ...DEFAULT_SPEC, ...(p.spec ?? {}) };
        spec.battery = { ...DEFAULT_SPEC.battery, ...(p.spec?.battery ?? {}) };
        // Any non-finite number from an older or hand-edited record falls
        // back to the default rather than poisoning the solve.
        for (const [k, v] of Object.entries(spec) as [keyof FrameSpec, unknown][]) {
          if (typeof v === "number" && !Number.isFinite(v)) {
            (spec as Record<string, unknown>)[k] = DEFAULT_SPEC[k];
          }
        }
        const step = STEPS.some((s) => s.id === p.step) ? p.step! : "aircraft";
        return { ...current, ...p, spec, step };
      },
      /*
        Without a migrate, zustand throws a version mismatch away silently and
        the user is dropped back to defaults with their record overwritten on
        the next edit. The merge above already tolerates old shapes, so the
        migration is simply to let it run.
      */
      migrate: (persisted) => persisted as StudioState,
    },
  ),
);

/**
 * Switching the make method has to carry the thickness field with it: 4 is a
 * sensible carbon sheet and a uselessly thin printed arm, so reusing the number
 * across the switch produces a design the user never asked for.
 */
export function defaultFixedDim(): number | null {
  // null means "let the studio choose". Switching material should hand the
  // decision back to the reference table rather than carrying a number across
  // that meant something different for the old material.
  return null;
}

/** Props a motor is usually flown on, used to keep the two selectors in step. */
export function propsForMotor(motorId: string): number[] {
  return motorById(motorId).props;
}

/** Typical assembled height for a stack on this mounting pattern, mm. */
export { stackHeightFor };

export const LAYOUT_HINT: Record<Layout, string> = {
  "true-x": "Equal arms, neutral handling. The default for a reason.",
  "stretched-x": "Longer than it is wide. Settles faster in forward flight.",
  h: "Wide battery bay between the arms. Easy to build and to service.",
  deadcat: "Front arms swept out of a camera's view. For anything you film with.",
};
