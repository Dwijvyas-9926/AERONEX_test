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

import { BufferGeometry, ExtrudeGeometry, Mesh, MeshBasicMaterial, Path, Shape, Vector2 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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
export function geometryFor(profile: Profile): BufferGeometry {
  const outer = new ExtrudeGeometry(shapeFor(profile), {
    depth: profile.thicknessMm,
    bevelEnabled: false,
    curveSegments: HOLE_SEGMENTS,
  });
  if (!profile.cavity) return outer;

  /*
    Hollow the arm.

    The void is enclosed on every side, so it cannot be expressed as a hole in
    the extruded profile — a hole would open out through the top and bottom
    faces and the part would be a channel, not a box. Instead the cavity is
    extruded as its own solid, flipped inside out, and merged in: a surface
    whose normals point inward reads as a void to every slicer, and the result
    is still one closed manifold.
  */
  const { outline, wallMm } = profile.cavity;
  const innerDepth = profile.thicknessMm - 2 * wallMm;
  if (innerDepth <= 0.2) return outer;

  const path = new Shape(toCCW(outline).map(([x, y]) => new Vector2(x, y)));
  const inner = new ExtrudeGeometry(path, { depth: innerDepth, bevelEnabled: false, curveSegments: 4 });
  inner.translate(0, 0, wallMm);
  flipNormals(inner);

  const outerFlat = outer.toNonIndexed();
  const innerFlat = inner.toNonIndexed();
  const merged = mergeGeometries([outerFlat, innerFlat], false);
  innerFlat.dispose();
  inner.dispose();
  if (!merged) {
    // Merging failed: keep the solid outer shell rather than returning a
    // geometry that has already been disposed, which renders as nothing.
    outerFlat.dispose();
    return outer;
  }
  outerFlat.dispose();
  outer.dispose();
  return merged;
}

/**
 * Reverse the winding, turning a solid into a void.
 *
 * Swapping two vertices of every triangle is the whole job: recomputing the
 * vertex normals afterwards then yields inward-facing normals on its own. An
 * earlier version also negated the normals explicitly, which put them back
 * the way they started and left the cavity's 116 triangles disagreeing with
 * their own winding. It never reached the STL — the exporter recomputes every
 * facet normal from the vertex order — but anything trusting the normal
 * attribute, the 3D preview included, saw it.
 */
function flipNormals(geo: BufferGeometry): void {
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, geo.getAttribute("normal"), geo.getAttribute("uv")]) {
      if (!attr) continue;
      for (let c = 0; c < attr.itemSize; c++) {
        const a = attr.getComponent(i, c);
        const b = attr.getComponent(i + 2, c);
        attr.setComponent(i, c, b);
        attr.setComponent(i + 2, c, a);
      }
    }
  }
  geo.computeVertexNormals();
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
    (mesh.material as { dispose(): void }).dispose();
    return {
      filename: `${profile.id}-x${profile.qty}-${Math.round(profile.thicknessMm * 10) / 10}mm.stl`,
      name: profile.name,
      qty: profile.qty,
      thicknessMm: profile.thicknessMm,
      data,
    };
  });
}
