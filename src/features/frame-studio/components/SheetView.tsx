import { useMemo } from "react";
import { nestParts } from "../exporters";
import { type FrameDesign, type Pt } from "../geometry";
import { useStudio } from "../store";

/*
  Sheet view — a preview of the exported file, not a separate illustration.

  It is drawn from exactly the same `nestParts` result that the DXF and SVG
  writers consume, so if the layout looks wrong here it is wrong in the file
  too. That is the point: this is the last chance to catch a part that has
  wandered off the sheet before someone pays to have it cut.
*/

const toPath = (pts: Pt[]) => `${pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("")}Z`;

export function SheetView({ design }: { design: FrameDesign }) {
  const sheetWidthMm = useStudio((s) => s.sheetWidthMm);
  const labelParts = useStudio((s) => s.labelParts);
  const nest = useMemo(
    () => nestParts(design.profiles, { sheetWidthMm, labels: labelParts }),
    [design.profiles, sheetWidthMm, labelParts],
  );

  const pad = 12;
  const W = nest.widthMm;
  const H = nest.heightMm;

  return (
    <div className="fs-sheet">
      <svg
        className="fs-sheet-svg"
        viewBox={`${-pad} ${-pad} ${W + pad * 2} ${H + pad * 2}`}
        role="img"
        aria-label={`Cut sheet, ${Math.ceil(W)} by ${Math.ceil(H)} millimetres`}
      >
        {/* Y is flipped once so the preview matches the exported SVG exactly. */}
        <g transform={`translate(0 ${H}) scale(1,-1)`}>
          <rect className="fs-sheet-stock" x={0} y={0} width={W} height={H} />
          {nest.parts.map((p, i) => (
            <g key={i} className="fs-sheet-part">
              <path d={toPath(p.outline)} />
              {p.slots.map((s, j) => <path key={j} className="fs-sheet-slot" d={toPath(s)} />)}
              {p.holes.map((h, j) => (
                <circle key={j} className="fs-sheet-hole" cx={h.c[0]} cy={h.c[1]} r={h.r} />
              ))}
            </g>
          ))}
        </g>
        {labelParts &&
          nest.parts.map((p, i) => (
            <text key={i} className="fs-sheet-label" x={p.labelAt[0]} y={H - p.labelAt[1]}>
              {p.label}
            </text>
          ))}
      </svg>

      <footer className="fs-sheet-foot">
        <span>
          <b>{Math.ceil(W)} × {Math.ceil(H)} mm</b> of {design.material.name.toLowerCase()}
        </span>
        <span>{nest.parts.length} parts · {Math.round(nest.utilisation * 100)}% material used</span>
        <span>{design.material.method === "cut" ? `${design.spec.fixedDimMm} mm sheet` : "plates and arms, printed separately"}</span>
      </footer>
    </div>
  );
}
