/*
  Frame Studio — 3D export for printed parts.

  Each part is a prism: its 2D profile swept through the thickness the solver
  chose for it. That is exactly what a printed plate or arm is, so there is no
  approximation in the shape — only in the mesh's facets, which are set fine
  enough that a slicer sees smooth holes.

  Winding matters. An extruded shape whose outline runs clockwise comes out
  with inverted normals, which slicers either reject or silently print inside
  out, so the outline is normalised to counter-clockwise before extrusion.
*/

import { ExtrudeGeometry, Mesh, MeshBasicMaterial, Path, Shape, Vector2 } from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { type Hole, type Pt, type Profile } from "./geometry";

/** Segments used around each bolt hole. 32 is smooth at any printable size. */
const HOLE_SEGMENTS = 32;

/** Signed area; positive means counter-clockwise. */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return a / 2;
}

const toCCW = (pts: Pt[]): Pt[] => (signedArea(pts) < 0 ? [...pts].reverse() : pts);
const toCW = (pts: Pt[]): Pt[] => (signedArea(pts) > 0 ? [...pts].reverse() : pts);

function holePath(h: Hole): Path {
  const p = new Path();
  // Clockwise, opposite the outline, so it reads as a hole rather than an island.
  p.absarc(h.c[0], h.c[1], h.r, 0, Math.PI * 2, true);
  return p;
}

/** Build the three.js Shape for a profile, holes and slots included. */
export function shapeFor(profile: Profile): Shape {
  const shape = new Shape(toCCW(profile.outline).map(([x, y]) => new Vector2(x, y)));
  for (const h of profile.holes) shape.holes.push(holePath(h));
  for (const s of profile.slots) {
    shape.holes.push(new Path(toCW(s).map(([x, y]) => new Vector2(x, y))));
  }
  return shape;
}

/** Extruded geometry for a profile, swept through its own thickness. */
export function geometryFor(profile: Profile): ExtrudeGeometry {
  return new ExtrudeGeometry(shapeFor(profile), {
    depth: profile.thicknessMm,
    bevelEnabled: false,
    curveSegments: HOLE_SEGMENTS,
  });
}

export interface StlPart {
  /** Suggested file name, without a directory. */
  filename: string;
  name: string;
  qty: number;
  thicknessMm: number;
  /** Binary STL bytes, in millimetres. */
  data: ArrayBuffer;
}

/**
 * One binary STL per distinct part.
 *
 * Deliberately one file per part rather than one of the whole frame: a slicer
 * needs each piece laid flat on the bed in its own orientation, and a single
 * assembled mesh would have to be cut apart again before it could be printed.
 */
export function toSTLParts(profiles: Profile[]): StlPart[] {
  const exporter = new STLExporter();
  return profiles.map((profile) => {
    const mesh = new Mesh(geometryFor(profile), new MeshBasicMaterial());
    const parsed = exporter.parse(mesh, { binary: true }) as unknown as DataView;
    const data = parsed.buffer.slice(parsed.byteOffset, parsed.byteOffset + parsed.byteLength) as ArrayBuffer;
    mesh.geometry.dispose();
    return {
      filename: `${profile.id}-x${profile.qty}-${profile.thicknessMm}mm.stl`,
      name: profile.name,
      qty: profile.qty,
      thicknessMm: profile.thicknessMm,
      data,
    };
  });
}
