import { derive, G, type Airframe } from "../sim/airframe";
import type { Params } from "../sim/params";
import type { RouteProfile } from "./profile";

/*
  A look over the plan before anything flies: the mistakes that can be seen
  from the numbers alone, without simulating. It runs on every change.

  It is a list of things to look at, not a verdict. The prediction flies the
  plan and says what happens; this says what is worth checking first.
*/
export interface CheckItem {
  sev: "bad" | "warn" | "note";
  text: string;
}

export interface CheckInput {
  points: { n: number; e: number; alt: number; holdS: number }[];
  takeoffAlt: number;
  ending: "rtl" | "land" | "hold";
  params: Params;
  airframe: Airframe;
  profile: RouteProfile;
  /** The ground under the route is known (measured, or the practice field). */
  groundKnown: boolean;
  /** Real ground is in use, with its limits. */
  real: boolean;
  /** How far from home the loaded ground reaches, m. Null when there is no such limit. */
  groundReach: number | null;
}

const far = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** Minutes the aircraft can hover on 80% of its battery, from momentum theory. */
export function hoverMinutes(af: Airframe): number {
  const d = derive(af);
  const watts = (4 * ((af.massKg * G) / 4) ** 1.5) / Math.sqrt(2 * 1.225 * (d.discArea / 4)) / 0.5;
  return (((af.capacityMah / 1000) * af.cells * 3.7 * 0.8) / watts) * 60;
}

/** A rough time for the whole flight, s: legs at cruise, climbs, waits, and the landing. */
export function flightSeconds(inp: Pick<CheckInput, "points" | "takeoffAlt" | "ending" | "params" | "profile">): number {
  const p = inp.params;
  const cruise = Math.max(0.5, (p.WPNAV_SPEED ?? 1000) / 100);
  const up = Math.max(0.3, (p.WPNAV_SPEED_UP ?? 250) / 100);
  const down = Math.max(0.3, (p.WPNAV_SPEED_DN ?? 150) / 100);
  let t = inp.takeoffAlt / up + inp.profile.length / cruise;
  let alt = inp.takeoffAlt;
  for (const w of inp.points) {
    // Climbs slower than the cruise can carry it add to the leg.
    t += Math.max(0, Math.abs(w.alt - alt) / (w.alt > alt ? up : down) * 0.5) + w.holdS + 3;
    alt = w.alt;
  }
  if (inp.ending !== "hold") t += Math.max(alt, inp.ending === "rtl" ? (p.RTL_ALT ?? 1500) / 100 : 0) / Math.max(0.3, (p.LAND_SPEED ?? 50) / 100) * 0.6 + 10;
  return t;
}

export function checkPlan(inp: CheckInput): CheckItem[] {
  const out: CheckItem[] = [];
  const { points, params: p, profile } = inp;
  if (!points.length) return out;
  const dist = points.map((w) => Math.hypot(w.n, w.e));
  const farthest = Math.max(...dist);
  const farI = dist.indexOf(farthest) + 1;
  const highest = Math.max(inp.takeoffAlt, ...points.map((w) => w.alt));

  // The ground.
  if (inp.groundReach !== null && farthest > inp.groundReach) {
    out.push({ sev: "bad", text: `Waypoint ${farI} is ${far(farthest)} from home, and ground heights are only loaded out to ${far(inp.groundReach)}. Clearance beyond that is not checked. Is home in the right place? Put it where the aircraft will take off.` });
  } else if (!inp.groundKnown) {
    out.push({ sev: "warn", text: "The ground heights are not loaded, so nothing here checks the route against the ground." });
  } else if (profile.lowest && profile.lowest.clear < 0) {
    out.push({ sev: "bad", text: `The route passes ${Math.round(-profile.lowest.clear)} m below the ground. See the height profile under the map.` });
  } else if (profile.lowest && profile.lowest.clear < 15) {
    out.push({ sev: "warn", text: `The route comes within ${Math.round(profile.lowest.clear)} m of the ground. See the height profile under the map.` });
  }

  // The fence.
  if (p.FENCE_ENABLE) {
    const type = p.FENCE_TYPE ?? 3;
    if (type & 2 && farthest > p.FENCE_RADIUS) out.push({ sev: "bad", text: `Waypoint ${farI} is ${far(farthest)} from home, outside the ${far(p.FENCE_RADIUS)} fence (FENCE_RADIUS). The aircraft will turn back at the fence and not finish the mission.` });
    if (type & 1 && highest > p.FENCE_ALT_MAX) out.push({ sev: "bad", text: `The plan climbs to ${Math.round(highest)} m, above the ${Math.round(p.FENCE_ALT_MAX)} m fence ceiling (FENCE_ALT_MAX). The aircraft will turn back there.` });
  }

  // Time against the battery.
  const secs = flightSeconds(inp);
  const endurance = hoverMinutes(inp.airframe) * 60;
  if (secs > endurance) out.push({ sev: "bad", text: `The flight needs about ${Math.round(secs / 60)} minutes, and this aircraft hovers for about ${Math.round(endurance / 60)} on a full battery. It cannot finish.` });
  else if (secs > 0.7 * endurance) out.push({ sev: "warn", text: `The flight needs about ${Math.round(secs / 60)} minutes of the ${Math.round(endurance / 60)} this aircraft can hover for. That leaves little for wind or a return against it.` });

  // Battery failsafe.
  if (!(p.BATT_FS_LOW_ACT > 0) || !(p.BATT_LOW_VOLT > 0 || p.BATT_LOW_MAH > 0)) out.push({ sev: "warn", text: "No low-battery failsafe is set (BATT_FS_LOW_ACT with BATT_LOW_VOLT or BATT_LOW_MAH). If the battery runs low away from home, nothing brings the aircraft back." });

  // Height and distance against the rules most places have.
  if (highest > 120) out.push({ sev: "warn", text: `The plan climbs to ${Math.round(highest)} m above home. Many countries limit small aircraft to 120 m (400 ft) above the ground: check the rules where you fly.` });
  if (farthest > 500 && !(inp.groundReach !== null && farthest > inp.groundReach)) out.push({ sev: "note", text: `The farthest point is ${far(farthest)} from home. A small aircraft is hard to see beyond about 500 m, and many countries require it to stay in sight.` });

  // The return.
  if (inp.ending === "rtl") {
    const last = points[points.length - 1];
    const rtl = (p.RTL_ALT ?? 0) / 100;
    if (rtl < last.alt - 0.5 && rtl > 0) out.push({ sev: "note", text: `The return home flies at ${Math.round(last.alt)} m, the height of the last waypoint, because that is above the ${Math.round(rtl)} m return height (RTL_ALT).` });
  }
  if (inp.ending === "hold") out.push({ sev: "warn", text: "The mission ends hovering at the last waypoint. Nothing lands the aircraft: you must take over before the battery runs out." });
  if (inp.real && inp.groundKnown) out.push({ sev: "note", text: "Trees, buildings, masts and wires are not in the ground data. Add their height to every clearance yourself." });
  return out;
}
