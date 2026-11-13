/*
  The route seen from the side: how high the aircraft flies and how high the
  ground is beneath it, all the way along.

  ArduCopter flies a straight line between waypoints, in height as well as
  over the ground, and it knows nothing of the land in between. A route whose
  waypoints all clear the ground can still pass through a ridge between two of
  them. This walks the whole line and finds where it comes closest.

  Heights are metres above home, as the autopilot counts them.
*/
export interface ProfilePoint {
  n: number;
  e: number;
  alt: number;
}

export interface ProfileSample {
  /** Distance along the route, m. */
  d: number;
  n: number;
  e: number;
  fly: number;
  ground: number;
}

export interface ProfileLeg {
  /** "Home", "1", "2"… */
  from: string;
  to: string;
  /** Where on the distance axis this leg ends. */
  endD: number;
  minClear: number;
}

export interface RouteProfile {
  samples: ProfileSample[];
  length: number;
  legs: ProfileLeg[];
  /** The closest the route comes to the ground, and where. Null with no route. */
  lowest: (ProfileSample & { clear: number; leg: number }) | null;
  /** Height of the ground at each waypoint, in order. */
  groundAt: number[];
}

export function routeProfile(
  points: ProfilePoint[],
  takeoffAlt: number,
  ending: "rtl" | "land" | "hold",
  /** Height a return home flies at, m. */
  rtlAlt: number,
  ground: (n: number, e: number) => number,
  /** Spacing of the samples, m. */
  step = 10,
): RouteProfile {
  const groundAt = points.map((p) => ground(p.n, p.e));
  if (!points.length) return { samples: [], length: 0, legs: [], lowest: null, groundAt };

  // The corners of the flight, after the climb straight up from home.
  const path: { n: number; e: number; alt: number; name: string }[] = [{ n: 0, e: 0, alt: takeoffAlt, name: "Home" }];
  points.forEach((p, i) => path.push({ ...p, name: String(i + 1) }));
  if (ending === "rtl") {
    // It climbs where it is, if it must, then flies home level.
    const last = points[points.length - 1];
    const h = Math.max(rtlAlt, last.alt);
    path.push({ n: last.n, e: last.e, alt: h, name: String(points.length) });
    path.push({ n: 0, e: 0, alt: h, name: "Home" });
  }

  const samples: ProfileSample[] = [];
  const legs: ProfileLeg[] = [];
  let lowest: RouteProfile["lowest"] = null;
  let d = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const len = Math.hypot(b.n - a.n, b.e - a.e);
    // A climb on the spot adds no distance and cannot be the low point.
    if (len < 0.5) continue;
    const count = Math.max(1, Math.ceil(len / step));
    let legMin = Infinity;
    for (let i = k === 1 || samples.length === 0 ? 0 : 1; i <= count; i++) {
      const t = i / count;
      const n = a.n + (b.n - a.n) * t;
      const e = a.e + (b.e - a.e) * t;
      const s: ProfileSample = { d: d + len * t, n, e, fly: a.alt + (b.alt - a.alt) * t, ground: ground(n, e) };
      samples.push(s);
      const clear = s.fly - s.ground;
      if (clear < legMin) legMin = clear;
      if (!lowest || clear < lowest.clear) lowest = { ...s, clear, leg: legs.length };
    }
    // The first sample of a later leg is the last of the one before.
    if (samples.length && legMin === Infinity) legMin = samples[samples.length - 1].fly - samples[samples.length - 1].ground;
    d += len;
    legs.push({ from: a.name, to: b.name, endD: d, minClear: legMin });
  }
  return { samples, length: d, legs, lowest, groundAt };
}
