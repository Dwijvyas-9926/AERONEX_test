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

export function PlanView({ design: d, focus, onFocus, showProps, showDims }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const active = focus ?? hover;

  const arm = d.profiles.find((p) => p.id === "arm")!;
  const bottom = d.profiles.find((p) => p.id === "bottom-plate")!;
  const top = d.profiles.find((p) => p.id === "top-plate")!;

  // Arms are drawn from the same profile the exporter writes, placed by the
  // same root radius the solver used — not a separate decorative shape.
  const arms = useMemo(() => {
    const shift = d.rootRadiusMm - d.armOverlapMm;
    return d.motors.map((m, i) => {
      const bearing = Math.atan2(m[1], m[0]);
      return {
        key: `arm-${i}`,
        outline: placeArm(arm.outline, bearing, shift),
        holes: arm.holes.map((h) => ({ ...h, c: placeArm([h.c], bearing, shift)[0] })),
        motor: m,
      };
    });
  }, [arm, d.motors, d.rootRadiusMm, d.armOverlapMm]);

  // Frame the drawing on its true extent, with room for the dimension lines.
  const reach = Math.max(...d.motors.map((m) => Math.hypot(m[0], m[1]))) + d.section.padWidthMm / 2;
  const span = showProps ? reach + d.propDiaMm / 2 : reach;
  const pad = Math.max(22, span * 0.13);
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
            className={`fs-part fs-arm${active === "arm" ? " is-active" : ""}`}
            onMouseEnter={() => { setHover("arm"); onFocus?.("arm"); }}
            onMouseLeave={() => { setHover(null); onFocus?.(null); }}
          >
            <path d={toPath(a.outline)} />
            {holeEls(a.holes, a.key)}
          </g>
        ))}

        <g
          className={`fs-part fs-plate${active === "bottom-plate" ? " is-active" : ""}`}
          onMouseEnter={() => { setHover("bottom-plate"); onFocus?.("bottom-plate"); }}
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
    </svg>
  );
}
