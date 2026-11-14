/*
  ArduPilot (Copter) PID tuning model for the basic tuning page.

  Two jobs:
   1. The control definitions — which parameters the sliders expose, with ranges
      chosen to bracket typical quad values. Roll and pitch share a control and
      can be written together ("mirror") since most symmetric frames keep them
      equal.
   2. A symptom → recommendation advisor: the user describes what the aircraft is
      doing and gets the parameter(s) to change, the direction, and why. Rules
      follow ArduPilot's standard manual-tuning guidance.

  Nothing here is a substitute for a real tune; it makes safe, incremental
  changes the pilot verifies in a short, controlled hover.
*/

export interface PidControl {
  name: string; // primary parameter (roll / the single axis)
  mirror?: string; // written together with `name` when roll+pitch are linked
  label: string;
  min: number;
  max: number;
  step: number;
  help?: string;
}

/** Roll & pitch rate + angle gains — the ones that drive horizontal wobble. */
export const HORIZONTAL: PidControl[] = [
  { name: "ATC_RAT_RLL_P", mirror: "ATC_RAT_PIT_P", label: "Rate P", min: 0.03, max: 0.35, step: 0.005, help: "Main stiffness of the rate loop. Too high → oscillation; too low → sloppy." },
  { name: "ATC_RAT_RLL_D", mirror: "ATC_RAT_PIT_D", label: "Rate D", min: 0.0, max: 0.03, step: 0.0005, help: "Damping. Too high → fast, high-pitched wobble; too low → overshoot." },
  { name: "ATC_RAT_RLL_I", mirror: "ATC_RAT_PIT_I", label: "Rate I", min: 0.03, max: 0.35, step: 0.005, help: "Removes steady error. Usually kept equal to Rate P." },
  { name: "ATC_ANG_RLL_P", mirror: "ATC_ANG_PIT_P", label: "Angle P", min: 3, max: 12, step: 0.1, help: "How hard it drives toward the target angle. High → twitchy; low → sluggish." },
];

/** Altitude / throttle controllers — the ones that drive vertical wobble. Names and units before ArduCopter 4.7. */
export const VERTICAL: PidControl[] = [
  { name: "PSC_ACCZ_P", label: "Accel Z P", min: 0.2, max: 1.5, step: 0.05, help: "Throttle stiffness. Too high → the aircraft bounces vertically." },
  { name: "PSC_ACCZ_I", label: "Accel Z I", min: 0.0, max: 3.0, step: 0.05, help: "Usually about twice Accel Z P. Too high → slow vertical hunting." },
  { name: "PSC_VELZ_P", label: "Velocity Z P", min: 1, max: 8, step: 0.1, help: "Climb/descent rate control. High → jerky altitude." },
  { name: "PSC_POSZ_P", label: "Position Z P", min: 0.5, max: 3.0, step: 0.05, help: "How hard it holds the altitude setpoint." },
];

/**
 * The same controllers on ArduCopter 4.7 and later, which renamed them
 * (PSC_ACCZ_P became PSC_D_ACC_P, and so on) and scaled the acceleration
 * gains by 0.1: 4.6's Accel Z P of 0.5 is 4.7's 0.05. The ranges here are in
 * 4.7's units, so a value from an old tuning guide does not land ten times
 * too high.
 */
export const VERTICAL_47: PidControl[] = [
  { name: "PSC_D_ACC_P", label: "Accel Z P", min: 0.02, max: 0.15, step: 0.005, help: "Throttle stiffness. Too high → the aircraft bounces vertically. 4.7 units: one tenth of 4.6's PSC_ACCZ_P." },
  { name: "PSC_D_ACC_I", label: "Accel Z I", min: 0.0, max: 0.3, step: 0.005, help: "Usually about twice Accel Z P. Too high → slow vertical hunting. 4.7 units: one tenth of 4.6's PSC_ACCZ_I." },
  { name: "PSC_D_VEL_P", label: "Velocity Z P", min: 1, max: 8, step: 0.1, help: "Climb/descent rate control. High → jerky altitude." },
  { name: "PSC_D_POS_P", label: "Position Z P", min: 0.5, max: 3.0, step: 0.05, help: "How hard it holds the altitude setpoint." },
];

/** Older vertical-gain name → the name ArduCopter 4.7 uses. */
const VERTICAL_RENAMED: Record<string, string> = Object.fromEntries(VERTICAL.map((c, i) => [c.name, VERTICAL_47[i].name]));

/** True when the aircraft's parameters use 4.7's vertical-gain names. */
export const hasNewVerticalNames = (values: Record<string, number>) => Number.isFinite(values.PSC_D_ACC_P) || Number.isFinite(values.PSC_D_VEL_P);

/** The vertical controls this aircraft actually has. */
export const verticalControls = (values: Record<string, number>): PidControl[] => (hasNewVerticalNames(values) ? VERTICAL_47 : VERTICAL);

/**
 * A recommendation with its parameter names as this aircraft has them. The
 * advice is a percentage, which is the same in either unit.
 */
export function recFor(rec: AdviceRec, values: Record<string, number>): AdviceRec {
  if (!hasNewVerticalNames(values)) return rec;
  return { ...rec, params: rec.params.map((p) => VERTICAL_RENAMED[p] ?? p) };
}

/** Yaw gains — secondary, for nose-wag. */
export const YAW: PidControl[] = [
  { name: "ATC_RAT_YAW_P", label: "Yaw Rate P", min: 0.1, max: 0.6, step: 0.005, help: "Yaw stiffness. Too high → the nose wags." },
  { name: "ATC_ANG_YAW_P", label: "Yaw Angle P", min: 3, max: 12, step: 0.1, help: "How hard it holds heading." },
];

export const ALL_PID_PARAMS: string[] = [
  ...HORIZONTAL.flatMap((c) => (c.mirror ? [c.name, c.mirror] : [c.name])),
  ...VERTICAL.map((c) => c.name),
  ...VERTICAL_47.map((c) => c.name),
  ...YAW.map((c) => c.name),
];

// ---- advisor ----

export interface AdviceRec {
  params: string[];
  direction: "decrease" | "increase";
  pct: number; // suggested step as a percentage of the current value
  why: string;
}

export interface Advice {
  id: string;
  title: string;
  recs: AdviceRec[];
  note?: string;
}

interface Rule extends Advice {
  keywords: string[];
}

const RULES: Rule[] = [
  {
    id: "fast-horizontal",
    title: "Fast, high-frequency wobble in roll/pitch",
    keywords: ["fast wobble", "high frequency", "high-frequency", "buzz", "vibrat", "fast oscillat", "jitter", "jittery", "shaky", "rapid", "twitch fast", "fast shake", "hums", "quiver"],
    recs: [
      { params: ["ATC_RAT_RLL_D", "ATC_RAT_PIT_D"], direction: "decrease", pct: 30, why: "Fast wobble is usually too much rate D. Drop D first." },
      { params: ["ATC_RAT_RLL_P", "ATC_RAT_PIT_P"], direction: "decrease", pct: 15, why: "If it continues after lowering D, ease off rate P too." },
    ],
    note: "First rule out mechanical causes: check the Preflight vibration panel and balance your props — real vibration mimics a D-term problem.",
  },
  {
    id: "slow-horizontal",
    title: "Slow rocking/oscillation in roll or pitch",
    keywords: ["slow wobble", "slow oscillat", "rock", "sway", "low frequency", "low-frequency", "wallow", "slow side to side", "slow shake", "pendulum", "slow roll"],
    recs: [
      { params: ["ATC_RAT_RLL_P", "ATC_RAT_PIT_P"], direction: "decrease", pct: 15, why: "Slow oscillation is usually too much rate P." },
      { params: ["ATC_ANG_RLL_P", "ATC_ANG_PIT_P"], direction: "decrease", pct: 15, why: "If it persists, lower angle P a little." },
    ],
  },
  {
    id: "vertical-bounce",
    title: "Bouncing / oscillating in altitude",
    keywords: ["up and down", "vertical", "altitude", "bounce", "bouncing", "height oscillat", "climbs and drops", "porpois", "hunting altitude", "yo-yo", "yoyo", "ascend descend"],
    recs: [
      { params: ["PSC_ACCZ_P"], direction: "decrease", pct: 25, why: "Vertical bounce is usually too much throttle (Accel Z) P." },
      { params: ["PSC_ACCZ_I"], direction: "decrease", pct: 25, why: "Lower Accel Z I alongside P to keep their ~2:1 ratio." },
      { params: ["PSC_VELZ_P"], direction: "decrease", pct: 20, why: "If it still hunts, soften the climb-rate gain." },
    ],
  },
  {
    id: "twitchy",
    title: "Twitchy / over-responsive",
    keywords: ["twitchy", "overreact", "over-react", "too sharp", "nervous", "over responsive", "over-responsive", "aggressive", "darty", "snappy"],
    recs: [
      { params: ["ATC_ANG_RLL_P", "ATC_ANG_PIT_P"], direction: "decrease", pct: 10, why: "Softer angle P calms sharp reactions to stick/hold." },
      { params: ["ATC_RAT_RLL_P", "ATC_RAT_PIT_P"], direction: "decrease", pct: 10, why: "Back rate P off slightly too." },
    ],
  },
  {
    id: "sluggish",
    title: "Sluggish / slow to respond",
    keywords: ["sluggish", "slow to respond", "unresponsive", "soft", "lazy", "delayed", "slow response", "mushy", "drifts off slowly", "doesn't hold angle"],
    recs: [
      { params: ["ATC_ANG_RLL_P", "ATC_ANG_PIT_P"], direction: "increase", pct: 10, why: "More angle P sharpens the response. Raise in small steps." },
      { params: ["ATC_RAT_RLL_P", "ATC_RAT_PIT_P"], direction: "increase", pct: 10, why: "A little more rate P adds authority — stop if wobble appears." },
    ],
  },
  {
    id: "yaw",
    title: "Yaw oscillation / nose wag",
    keywords: ["yaw", "nose wag", "nose-wag", "heading oscillat", "wags", "rotate oscillat", "heading hunt", "nose swings", "spins slowly"],
    recs: [{ params: ["ATC_RAT_YAW_P"], direction: "decrease", pct: 20, why: "Ease yaw rate P to stop the nose hunting. If yaw is sluggish instead, raise it." }],
  },
  {
    id: "drift",
    title: "Drifts / won't hold position",
    keywords: ["drift", "won't hold position", "wander", "toilet bowl", "circles", "flies away", "position hold", "won't stay", "loiter bad"],
    recs: [],
    note: "This is usually not a PID issue. Position hold depends on compass and GPS — run Compass calibration, check Preflight for GPS fix and EKF health, and keep the aircraft away from metal. Tune PIDs only once it holds a steady hover in Stabilize/AltHold.",
  },
];

/**
 * Match a free-text problem description to one or two tuning recommendations.
 * Scores rules by how many of their key phrases appear; returns the best matches.
 */
export function advise(input: string): Advice[] {
  const text = ` ${input.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ")} `;
  // A key phrase matches when every one of its words appears somewhere in the
  // text (as a substring, so plurals and word order don't matter).
  const has = (phrase: string) =>
    phrase
      .replace(/[^a-z0-9\s]/g, " ")
      .split(" ")
      .filter(Boolean)
      .every((w) => text.includes(w));
  const scored = RULES.map((r) => ({ rule: r, score: r.keywords.reduce((n, k) => n + (has(k) ? 1 : 0), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return scored.slice(0, 2).map(({ rule: { keywords, ...rest } }) => rest);
}

export const SYMPTOM_CHIPS = [
  "Fast wobble when hovering",
  "Slow rocking side to side",
  "Bounces up and down",
  "Feels twitchy",
  "Sluggish to respond",
  "Nose wags (yaw)",
];
