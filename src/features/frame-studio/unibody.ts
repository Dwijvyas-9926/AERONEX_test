/*
  Frame Studio — unibody construction.

  A unibody frame cuts the arms and the bottom plate from one piece. It is the
  other half of how frames are actually built, and for small frames it is the
  more common half: fewer parts, no arm bolts, no second bottom plate, and
  noticeably lighter. The trade is repairability — break an arm and the whole
  plate is scrap, where a bolted arm is a two-minute swap.

  Geometrically it is a union: plate ∪ four arms. Rather than implement general
  polygon boolean operations, this exploits a property the shapes happen to
  have — every one of them is star-shaped about the frame centre, because the
  plate surrounds the origin and each arm radiates out from it. For a
  star-shaped set, the union's boundary along any ray from the centre is simply
  the furthest boundary crossing of any member. So the union reduces to casting
  rays and taking a maximum, which is short, has no degenerate cases to handle,
  and cannot produce the self-intersections a clipping library would need
  guarding against.
*/

import { type Pt } from "./geometry";

/** Furthest crossing of the ray from the origin at `angle` with a polygon, or 0. */
function furthestHit(poly: Pt[], cos: number, sin: number): number {
  let best = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    /*
      Solve origin + t·d = a + u·(b − a) for t ≥ 0 and u ∈ [0, 1].
      Cross-product form avoids dividing before the parallel check.
    */
    const ex = bx - ax;
    const ey = by - ay;
    const denom = cos * ey - sin * ex;
    if (Math.abs(denom) < 1e-12) continue; // ray parallel to this edge
    const t = (ax * ey - ay * ex) / denom;
    if (t <= best) continue;
    // u comes from crossing both sides with the ray direction:
    //   (A × d) + u·(E × d) = 0,  and  E × d = −denom
    // so u = (ax·sin − ay·cos) / denom. Getting this sign wrong silently
    // rejects every real crossing and keeps the spurious ones.
    const u = (ax * sin - ay * cos) / denom;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    best = t;
  }
  return best;
}

/**
 * Outline of the union of a centre plate and its arms.
 *
 * `segments` sets the angular resolution. The result is simplified afterwards,
 * so this can be generous: sampling finely and then dropping collinear points
 * keeps curves smooth and straight runs cheap, where a coarse sample would
 * visibly facet the motor pads.
 */
export function unibodyOutline(plate: Pt[], arms: Pt[][], segments = 360): Pt[] {
  const shapes = [plate, ...arms];

  /*
    Sample at every source vertex, not on a fixed grid.

    A uniform sweep cuts corners: it lands either side of a motor pad's
    tangent point and chords across it, shaving the pad below the edge
    distance its bolts were sized for. Casting a ray at each source vertex's
    own angle puts a point exactly on every corner of every input, so the
    union is faithful where it matters. A ray a hair either side of each
    vertex captures true corners, where two edges meet at an angle, and the
    uniform fill keeps long curves smooth between vertices.
  */
  const angles = new Set<number>();
  const EPS = 1e-4;
  for (const shape of shapes) {
    for (const [x, y] of shape) {
      const a = Math.atan2(y, x);
      angles.add(a - EPS);
      angles.add(a);
      angles.add(a + EPS);
    }
  }
  for (let i = 0; i < segments; i++) angles.add(-Math.PI + (Math.PI * 2 * i) / segments);

  const pts: Pt[] = [];
  for (const a of [...angles].sort((p, q) => p - q)) {
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    let r = 0;
    for (const shape of shapes) r = Math.max(r, furthestHit(shape, cos, sin));
    if (r > 0) pts.push([r * cos, r * sin]);
  }
  // Tight tolerance: the pads are sized to their bolts with no margin to give.
  return simplify(pts, 0.01);
}

/**
 * Drop points that lie within `tol` of the line through their neighbours.
 *
 * A 1440-point outline is faithful but wasteful: most of it is straight arm
 * edges that need two points, not forty. This keeps the curvature where there
 * is curvature and collapses the rest, which matters because every one of
 * these points becomes a VERTEX record in the DXF.
 */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 4 || tol <= 0) return pts;

  /*
    Douglas–Peucker, not a neighbour-by-neighbour collinearity test.

    A local test is wrong here and wrong in a way that looks plausible. Sampled
    at one degree, a point on a 45 mm arc sits only 0.007 mm off the chord
    through its immediate neighbours — below any useful tolerance — so a local
    test calls every point on every curve collinear and deletes the lot,
    leaving a handful of sharp corners and a quarter of the original area.
    Douglas–Peucker measures deviation across a whole run against its chord,
    so a curve keeps exactly as many points as the tolerance requires and a
    straight edge keeps two.
  */
  const sq = (v: number) => v * v;
  const distToSegment = (p: Pt, a: Pt, b: Pt): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = sq(dx) + sq(dy);
    if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  const run = (from: number, to: number, keep: boolean[]): void => {
    if (to <= from + 1) return;
    let worst = 0;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distToSegment(pts[i], pts[from], pts[to]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst <= tol || at < 0) return;
    keep[at] = true;
    run(from, at, keep);
    run(at, to, keep);
  };

  /*
    The outline is closed, so it has no natural start. Anchor on two points
    that are definitely on the hull — the first point and the one furthest
    from it — and simplify each half between them.
  */
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }

  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[far] = true;
  run(0, far, keep);
  // Second half wraps past the end, so walk it on a rotated copy.
  const tail = [...pts.slice(far), pts[0]];
  const tailKeep = new Array<boolean>(tail.length).fill(false);
  tailKeep[0] = true;
  tailKeep[tail.length - 1] = true;
  const runTail = (from: number, to: number): void => {
    if (to <= from + 1) return;
    let worst = 0;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const d = distToSegment(tail[i], tail[from], tail[to]);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst <= tol || at < 0) return;
    tailKeep[at] = true;
    runTail(from, at);
    runTail(at, to);
  };
  runTail(0, tail.length - 1);
  for (let i = 1; i < tail.length - 1; i++) if (tailKeep[i]) keep[far + i] = true;

  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}
