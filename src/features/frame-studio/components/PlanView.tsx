import { useMemo, useState } from "react";
import { type FrameDesign, type Hole, type Pt } from "../geometry";

/*
  Plan view — the authoritative drawing.

  Everything is in millimetres in the SVG user space, with a viewBox that maps
  one unit to one millimetre, so the drawing is the design rather than an
  impression of it. Y is flipped once, at the transform, so the rest of the
  component can think in the same +Y-is-forward coordinates as the solver.
*/

interface Props {
  design: FrameDesign;
  /** Highlighted part id, driven by hovering the parts list. */
  focus?: string | null;
  onFocus?: (id: string | null) => void;
  showProps: boolean;
  showDims: boolean;
  showSection: boolean;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** Rotate a local arm outline onto its bearing and shift it out to the root. */
function placeArm(pts: Pt[], bearing: number, shift: number): Pt[] {
  const cos = Math.cos(bearing);
  const sin = Math.sin(bearing);
  return pts.map(([x, y]) => {
    const X = x + shift;
    return [X * cos - y * sin, X * sin + y * cos] as Pt;
  });
}

const toPath = (pts: Pt[]) => `${pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`;

export function PlanView({ design: d, focus, onFocus, showProps, showDims, showSection }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const active = focus ?? hover;

  const unibody = d.spec.construction === "unibody";
  const armParts = d.profiles.filter((p) => p.cantileverMm !== undefined);
  const bottom = d.profiles.find((p) => p.id === "bottom-plate" || p.id === "chassis")!;
  const top = d.profiles.find((p) => p.id === "top-plate")!;

  // Arms are drawn from the same profile the exporter writes, placed by the
  // same root radius the solver used — not a separate decorative shape.
  /*
    Arms are drawn from the same profiles the exporter writes, each at its own
    bearing. A unibody has none to draw separately — they are part of the
    chassis outline.
  */
  const arms = useMemo(() => {
    if (unibody) return [];
    const shift = d.rootRadiusMm - d.armOverlapMm;
    const out: { key: string; outline: Pt[]; holes: Hole[] }[] = [];
    for (const part of armParts) {
      const group = d.armGroups.find((gr: { id: string }) => gr.id === part.id);
      for (const [i, bearing] of (group?.bearings ?? []).entries()) {
        out.push({
          key: `${part.id}-${i}`,
          outline: placeArm(part.outline, bearing, shift),
          holes: part.holes.map((h) => ({ ...h, c: placeArm([h.c], bearing, shift)[0] })),
        });
      }
    }
    return out;
  }, [armParts, d.armGroups, d.rootRadiusMm, d.armOverlapMm, unibody]);

  // Frame the drawing on its true extent, with room for the dimension lines.
  const reach = Math.max(...d.motors.map((m) => Math.hypot(m[0], m[1]))) + d.section.padWidthMm / 2;
  const span = showProps ? reach + d.propDiaMm / 2 : reach;
  const pad = Math.max(34, span * 0.2);
  const half = span + pad;

  /*
    Dimensions live outside the Y flip and convert points themselves, so the
    text is never mirrored. `t` slides the label along the line — a wheelbase
    label at the midpoint would land on top of the centre plate — and `off`
    pushes it clear of the geometry at right angles to the line.
  */
  const dim = (ad: Pt, bd: Pt, label: string, t = 0.5, off = 0) => {
    const a: Pt = [ad[0], -ad[1]];
    const b: Pt = [bd[0], -bd[1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    // A normal has two directions and only one of them is clear of the frame.
    // Take whichever pushes the label further from the centre.
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    if (Math.hypot(px + nx * off, py + ny * off) < Math.hypot(px - nx * off, py - ny * off)) {
      nx = -nx;
      ny = -ny;
    }
    const lx = px + nx * off;
    const ly = py + ny * off;
    const tick = 3;
    return (
      <g className="fs-dim">
        <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
        <line x1={a[0] + nx * tick} y1={a[1] + ny * tick} x2={a[0] - nx * tick} y2={a[1] - ny * tick} className="fs-dim-tick" />
        <line x1={b[0] + nx * tick} y1={b[1] + ny * tick} x2={b[0] - nx * tick} y2={b[1] - ny * tick} className="fs-dim-tick" />
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">{label}</text>
      </g>
    );
  };

  const holeEls = (holes: Hole[], key: string) =>
    holes.map((h, i) => <circle key={`${key}-${i}`} className="fs-hole" cx={h.c[0]} cy={h.c[1]} r={h.r} />);

  return (
    <svg
      className="fs-plan"
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      role="img"
      aria-label={`Plan view of a ${d.wheelbaseMm} millimetre ${d.spec.layout} frame`}
    >
      {/* Y down in SVG, +Y forward in the design: flip once, here. */}
      <g transform="scale(1,-1)">
        {showProps && (
          <g className="fs-props">
            {d.motors.map((m, i) => (
              <circle key={i} cx={m[0]} cy={m[1]} r={d.propDiaMm / 2} />
            ))}
          </g>
        )}

        <g className="fs-axes">
          <line x1={-span} y1={0} x2={span} y2={0} />
          <line x1={0} y1={-span} x2={0} y2={span} />
        </g>

        {arms.map((a) => (
          <g
            key={a.key}
            className={`fs-part fs-arm${active && a.key.startsWith(active) ? " is-active" : ""}`}
            onMouseEnter={() => { setHover(a.key.replace(/-\d+$/, "")); onFocus?.(a.key.replace(/-\d+$/, "")); }}
            onMouseLeave={() => { setHover(null); onFocus?.(null); }}
          >
            <path d={toPath(a.outline)} />
            {holeEls(a.holes, a.key)}
          </g>
        ))}

        <g
          className={`fs-part fs-plate${active === bottom.id ? " is-active" : ""}`}
          onMouseEnter={() => { setHover(bottom.id); onFocus?.(bottom.id); }}
          onMouseLeave={() => { setHover(null); onFocus?.(null); }}
        >
          <path d={toPath(bottom.outline)} />
          {bottom.slots.map((s, i) => <path key={i} className="fs-slot" d={toPath(s)} />)}
          {holeEls(bottom.holes, "bp")}
        </g>

        <g
          className={`fs-part fs-topplate${active === "top-plate" ? " is-active" : ""}`}
          onMouseEnter={() => { setHover("top-plate"); onFocus?.("top-plate"); }}
          onMouseLeave={() => { setHover(null); onFocus?.(null); }}
        >
          <path d={toPath(top.outline)} />
        </g>

        {/* Motor centres, so the wheelbase reads against something real. */}
        <g className="fs-motors">
          {d.motors.map((m, i) => (
            <g key={i}>
              <circle cx={m[0]} cy={m[1]} r={2} />
              <circle cx={m[0]} cy={m[1]} r={d.motor.pattern * 0.72} className="fs-motor-body" />
            </g>
          ))}
        </g>

      </g>

      {/* Dimensions sit outside the flip — see the note on `dim`. */}
      {showDims && (
        <g>
          {dim(d.motors[0], d.motors[2], `${fmt(d.wheelbaseMm)} mm wheelbase`, 0.86, 7)}
          {(() => {
            // Exposed arm length, measured along one arm's own bearing.
            const m = d.motors[1];
            const a = Math.atan2(m[1], m[0]);
            const root: Pt = [d.rootRadiusMm * Math.cos(a), d.rootRadiusMm * Math.sin(a)];
            return dim(root, m, `arm ${fmt(d.armLengthMm)} mm`, 0.5, d.section.padWidthMm / 2 + 7);
          })()}
          {dim(
            [-d.bodyWmm / 2, -d.bodyLmm / 2 - 8],
            [d.bodyWmm / 2, -d.bodyLmm / 2 - 8],
            `plate ${fmt(d.bodyWmm)} × ${fmt(d.bodyLmm)} mm`,
            0.5,
            8,
          )}
        </g>
      )}

      {/* Forward indicator, outside the flip so the glyph reads correctly. */}
      <g className="fs-fwd" transform={`translate(0 ${-half + pad * 0.55})`}>
        <path d="M0,-6 L5,4 L0,1.5 L-5,4 Z" />
        <text y={14} textAnchor="middle">FWD</text>
      </g>

      {/*
        Drawing furniture: a scale bar and a title block, drawn in the same
        millimetre space as everything else so the scale bar is honest at any
        zoom. Both sit outside the Y flip so their text reads normally.
      */}
      {showDims && <ScaleBar half={half} pad={pad} />}
      {showDims && <TitleBlock d={d} half={half} pad={pad} />}

      {/* Section detail: what the arm actually looks like cut through. */}
      {showSection && <SectionDetail d={d} half={half} pad={pad} />}
    </svg>
  );
}

/** A bar of a round number of millimetres, so the drawing can be eyeballed. */
function ScaleBar({ half, pad }: { half: number; pad: number }) {
  // Pick a round length around a fifth of the drawing width.
  const target = (half * 2) / 5;
  const step = [5, 10, 20, 25, 50, 100, 200].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a), 5);
  const x = -half + pad * 0.7;
  const y = half - pad * 0.5;
  return (
    <g className="fs-scalebar">
      <line x1={x} y1={y} x2={x + step} y2={y} />
      <line x1={x} y1={y - 3} x2={x} y2={y + 3} />
      <line x1={x + step} y1={y - 3} x2={x + step} y2={y + 3} />
      <line x1={x + step / 2} y1={y - 2} x2={x + step / 2} y2={y + 2} />
      <text x={x + step / 2} y={y - 5} textAnchor="middle">{step} mm</text>
    </g>
  );
}

/** Drawing identification, the way a real sheet carries it. */
function TitleBlock({ d, half, pad }: { d: FrameDesign; half: number; pad: number }) {
  const rows: [string, string][] = [
    ["LAYOUT", d.spec.layout.replace("-", " ").toUpperCase()],
    ["WHEELBASE", `${fmt(d.wheelbaseMm)} mm`],
    ["ARM", `${fmt(d.section.widthMm)} × ${fmt(d.section.heightMm)} mm${d.section.hollow ? " BOX" : ""}`],
    ["PLATES", `${fmt(d.stock.bottomPlateMm)} / ${fmt(d.stock.topPlateMm)} mm`],
    ["MATERIAL", d.material.name.toUpperCase()],
    ["AUW", `${fmt(d.mass.auwG)} g · T/W ${d.thrustToWeight.toFixed(1)}`],
  ];
  const w = Math.max(74, half * 0.46);
  const rowH = 7.5;
  const h = rowH * rows.length + 9;
  const x = half - pad * 0.4 - w;
  const y = half - pad * 0.4 - h;
  return (
    <g className="fs-titleblock" transform={`translate(${x} ${y})`}>
      <rect width={w} height={h} />
      <line x1={0} y1={9} x2={w} y2={9} />
      <text className="fs-tb-title" x={3.5} y={6.4}>AERONEX FRAME STUDIO</text>
      {rows.map(([k, v], i) => (
        <g key={k} transform={`translate(0 ${9 + rowH * i})`}>
          <text className="fs-tb-key" x={3.5} y={5.4}>{k}</text>
          <text className="fs-tb-val" x={w - 3.5} y={5.4} textAnchor="end">{v}</text>
        </g>
      ))}
    </g>
  );
}

/**
 * Cut-through of the arm, drawn to the same scale as the plan.
 *
 * This is the one view that shows what the solver actually decided: a printed
 * arm is a box, and no plan view can show that. Drawing it at true scale beside
 * the frame also makes the proportion obvious at a glance — an arm that is too
 * deep for its width looks wrong here long before the numbers say so.
 */
function SectionDetail({ d, half, pad }: { d: FrameDesign; half: number; pad: number }) {
  const s = d.section;
  /*
    Detail views are drawn enlarged, and are labelled with the enlargement.
    A 16 x 7 mm section on a 400 mm frame is four pixels at true scale, which
    tells the user nothing — so it is blown up to a readable size and the ratio
    is stated, exactly as it would be on a real sheet.
  */
  const target = half * 0.42;
  const raw = target / Math.max(s.widthMm, 1);
  const scale = [1, 2, 2.5, 4, 5, 8, 10, 16, 20].reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a), 1);
  const w = s.widthMm * scale;
  const h = s.heightMm * scale;
  const wall = s.wallMm * scale;
  const x = -half + pad * 0.6;
  const y = -half + pad * 0.6;

  return (
    <g className="fs-section" transform={`translate(${x} ${y})`}>
      <text className="fs-section-title" y={-6}>
        SECTION A–A · ARM ROOT ({scale}:1)
      </text>
      <rect width={w} height={h} />
      {s.hollow && (
        <rect
          className="fs-section-void"
          x={wall}
          y={wall}
          width={Math.max(0, w - 2 * wall)}
          height={Math.max(0, h - 2 * wall)}
        />
      )}
      {/* Width and depth witness lines, so the enlargement is unambiguous. */}
      <g className="fs-section-wit">
        <line x1={0} y1={h + 4} x2={w} y2={h + 4} />
        <line x1={0} y1={h + 2} x2={0} y2={h + 6} />
        <line x1={w} y1={h + 2} x2={w} y2={h + 6} />
        <line x1={w + 4} y1={0} x2={w + 4} y2={h} />
        <line x1={w + 2} y1={0} x2={w + 6} y2={0} />
        <line x1={w + 2} y1={h} x2={w + 6} y2={h} />
      </g>
      <text className="fs-section-dim" x={w / 2} y={h + 13} textAnchor="middle">{fmt(s.widthMm)} mm</text>
      <text className="fs-section-dim" x={w + 8} y={h / 2 + 2}>{fmt(s.heightMm)} mm</text>
      <text className="fs-section-note" y={h + 21}>
        {s.hollow ? `hollow box · ${fmt(s.wallMm)} mm wall` : "solid"}
      </text>
      <text className="fs-section-note" y={h + 28}>
        I = {Math.round(s.inertiaMm4)} mm⁴ · A = {Math.round(s.areaMm2)} mm²
      </text>
    </g>
  );
}
