/*
  Primary Flight Display — a large artificial horizon with pitch ladder, roll
  scale, and rolling speed / altitude / heading tapes, drawn as one responsive
  SVG. Driven entirely by live telemetry; values arrive already in display units.
  Styled as a glass cockpit instrument on a navy panel: the one place the app goes dark, as an aircraft display does.
*/

export interface PfdProps {
  roll: number; // degrees
  pitch: number; // degrees
  heading: number; // degrees 0..360
  speed: number;
  speedUnit: string;
  altitude: number;
  altUnit: string;
  climb: number; // m/s (+up)
  throttle: number; // 0..100
  stale: boolean;
  hasData: boolean;
}

const W = 960;
const H = 560;
const AW = { x: 268, y: 28, w: 424, h: 416 }; // attitude window
const cx = AW.x + AW.w / 2;
const cy = AW.y + AW.h / 2;
const PPD = 6.2; // pitch pixels per degree
const RARC = AW.w / 2 - 10;

const rollTicks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

export function Pfd(p: PfdProps) {
  return (
    <svg className={`pfd${p.stale ? " stale" : ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Primary flight display">
      <defs>
        <clipPath id="pfd-aw">
          <rect x={AW.x} y={AW.y} width={AW.w} height={AW.h} rx={14} />
        </clipPath>
        <linearGradient id="pfd-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1f4f8a" />
          <stop offset="0.75" stopColor="#3c78b8" />
          <stop offset="1" stopColor="#5f97cf" />
        </linearGradient>
        <linearGradient id="pfd-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a5532" />
          <stop offset="0.5" stopColor="#5c3f25" />
          <stop offset="1" stopColor="#3d2a19" />
        </linearGradient>
        <linearGradient id="pfd-tape" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(20,33,61,0.86)" />
          <stop offset="1" stopColor="rgba(11,20,40,0.86)" />
        </linearGradient>
        <radialGradient id="pfd-inner" cx="0.5" cy="0.44" r="0.72">
          <stop offset="0.6" stopColor="rgba(0,0,0,0)" />
          <stop offset="1" stopColor="rgba(5,10,22,0.5)" />
        </radialGradient>
      </defs>

      {/* ---- attitude ball ---- */}
      <g clipPath="url(#pfd-aw)">
        <g transform={`rotate(${-p.roll} ${cx} ${cy})`}>
          <g transform={`translate(0 ${p.pitch * PPD})`}>
            <rect x={cx - 1300} y={cy - 1700} width={2600} height={1700} fill="url(#pfd-sky)" />
            <rect x={cx - 1300} y={cy} width={2600} height={1700} fill="url(#pfd-ground)" />
            <rect x={cx - 1300} y={cy - 2} width={2600} height={3} fill="#ffffff" />
            <rect x={cx - 1300} y={cy + 2} width={2600} height={1.5} fill="#f4a259" opacity={0.6} />
            {/* pitch ladder */}
            {[-80, -70, -60, -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80].map((d) => {
              const y = cy - d * PPD;
              const half = d % 20 === 0 ? 58 : 30;
              return (
                <g key={d} stroke="#f4f2ec" strokeWidth={1.5} strokeLinecap="round">
                  <line x1={cx - half} x2={cx + half} y1={y} y2={y} />
                  {d % 20 === 0 && (
                    <>
                      <text x={cx - half - 9} y={y + 4.5} fill="#f4f2ec" fontSize={13} textAnchor="end" stroke="none" fontFamily="var(--font-display)">{Math.abs(d)}</text>
                      <text x={cx + half + 9} y={y + 4.5} fill="#f4f2ec" fontSize={13} textAnchor="start" stroke="none" fontFamily="var(--font-display)">{Math.abs(d)}</text>
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </g>
        <rect x={AW.x} y={AW.y} width={AW.w} height={AW.h} fill="url(#pfd-inner)" />
      </g>
      {/* bezel */}
      <rect x={AW.x - 2} y={AW.y - 2} width={AW.w + 4} height={AW.h + 4} rx={16} fill="none" stroke="#0b1428" strokeWidth={4} />
      <rect x={AW.x} y={AW.y} width={AW.w} height={AW.h} rx={14} fill="none" stroke="rgba(244,162,89,0.4)" strokeWidth={1.5} />

      {/* ---- roll scale + moving pointer ---- */}
      <g stroke="#dde2ea" fill="#dde2ea">
        {rollTicks.map((t) => {
          const a = (t * Math.PI) / 180;
          const len = t % 30 === 0 || t === 0 ? 15 : 9;
          const x1 = cx + RARC * Math.sin(a);
          const y1 = cy - RARC * Math.cos(a);
          const x2 = cx + (RARC - len) * Math.sin(a);
          const y2 = cy - (RARC - len) * Math.cos(a);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={t === 0 ? 2.6 : 1.6} />;
        })}
        <g transform={`rotate(${-p.roll} ${cx} ${cy})`}>
          <polygon points={`${cx},${cy - RARC + 17} ${cx - 10},${cy - RARC + 33} ${cx + 10},${cy - RARC + 33}`} fill="#f4a259" stroke="none" />
        </g>
      </g>

      {/* ---- fixed aircraft reference ---- */}
      <g stroke="#0b1428" strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.5}>
        <path d={`M${cx - 98} ${cy} H${cx - 36} L${cx - 27} ${cy + 13}`} />
        <path d={`M${cx + 98} ${cy} H${cx + 36} L${cx + 27} ${cy + 13}`} />
      </g>
      <g stroke="#f4a259" strokeWidth={3.5} fill="none" strokeLinecap="round">
        <path d={`M${cx - 98} ${cy} H${cx - 36} L${cx - 27} ${cy + 13}`} />
        <path d={`M${cx + 98} ${cy} H${cx + 36} L${cx + 27} ${cy + 13}`} />
      </g>
      <circle cx={cx} cy={cy} r={4.5} fill="#f4a259" stroke="#0b1428" strokeWidth={1} />

      {/* ---- tapes ---- */}
      <Tape x={118} w={122} value={p.speed} unit={p.speedUnit} step={5} pxPerUnit={7} side="left" label="SPD" has={p.hasData} />
      <Tape x={720} w={128} value={p.altitude} unit={p.altUnit} step={5} pxPerUnit={3} side="right" label="ALT" has={p.hasData} />
      <HeadingTape heading={p.heading} has={p.hasData} />

      {/* ---- V/S + throttle ---- */}
      <Corner x={866} y={cy} label="V/S" value={p.hasData ? `${p.climb >= 0 ? "+" : ""}${p.climb.toFixed(1)}` : "—"} align="start" />
      <Corner x={94} y={cy} label="THR" value={p.hasData ? `${Math.round(p.throttle)}%` : "—"} align="end" />

      {!p.hasData && <text x={cx} y={cy - 90} textAnchor="middle" fill="#f4f2ec" fontSize={16} fontFamily="var(--font-display)">Waiting for telemetry…</text>}
    </svg>
  );
}

function Corner({ x, y, label, value, align }: { x: number; y: number; label: string; value: string; align: "start" | "end" }) {
  return (
    <g>
      <text x={x} y={y - 12} textAnchor={align} fontSize={11} fill="var(--muted)" letterSpacing="0.05em">{label}</text>
      <text x={x} y={y + 10} textAnchor={align} fontSize={18} fill="var(--ink)" fontFamily="var(--font-display)">{value}</text>
    </g>
  );
}

function Tape({ x, w, value, unit, step, pxPerUnit, side, label, has }: { x: number; w: number; value: number; unit: string; step: number; pxPerUnit: number; side: "left" | "right"; label: string; has: boolean }) {
  const top = AW.y + 6;
  const h = AW.h - 12;
  const midY = top + h / 2;
  const range = Math.ceil(h / 2 / pxPerUnit / step) * step + step;
  const marks: number[] = [];
  const base = Math.round(value / step) * step;
  for (let v = base - range; v <= base + range; v += step) marks.push(v);
  const bx = side === "left" ? x : x; // box spans the tape
  const boxPts = side === "left"
    ? `${bx + w},${midY - 22} ${bx + w + 15},${midY} ${bx + w},${midY + 22} ${bx},${midY + 22} ${bx},${midY - 22}`
    : `${bx},${midY - 22} ${bx - 15},${midY} ${bx},${midY + 22} ${bx + w},${midY + 22} ${bx + w},${midY - 22}`;
  return (
    <g>
      <rect x={x} y={top} width={w} height={h} rx={8} fill="url(#pfd-tape)" stroke="rgba(244,242,236,0.16)" />
      <text x={x + w / 2} y={top - 9} textAnchor="middle" fontSize={11} fill="var(--muted)" letterSpacing="0.06em">{label} · {unit}</text>
      <clipPath id={`tape-${label}`}><rect x={x} y={top} width={w} height={h} rx={8} /></clipPath>
      <g clipPath={`url(#tape-${label})`}>
        {has && marks.map((m) => {
          const y = midY - (m - value) * pxPerUnit;
          if (m < 0) return null;
          const major = m % (step * 2) === 0;
          return (
            <g key={m}>
              <line x1={side === "left" ? x + w - (major ? 14 : 8) : x} x2={side === "left" ? x + w : x + (major ? 14 : 8)} y1={y} y2={y} stroke="#b8c0cf" strokeWidth={major ? 1.6 : 0.8} opacity={major ? 0.9 : 0.5} />
              {major && <text x={side === "left" ? x + w - 20 : x + 20} y={y + 4.5} textAnchor={side === "left" ? "end" : "start"} fontSize={13} fill="#b8c0cf" fontFamily="var(--font-display)">{m}</text>}
            </g>
          );
        })}
      </g>
      <polygon points={boxPts} fill="#0b1428" stroke="#f4a259" strokeWidth={1.6} />
      <text x={x + w / 2} y={midY + 7} textAnchor="middle" fontSize={22} fontWeight={600} fill="#f4f2ec" fontFamily="var(--font-display)">{has ? Math.round(value) : "—"}</text>
    </g>
  );
}

function HeadingTape({ heading, has }: { heading: number; has: boolean }) {
  const y = 474;
  const x = AW.x;
  const w = AW.w;
  const hh = 54;
  const midX = x + w / 2;
  const pxPerDeg = 4.4;
  const reach = (Math.ceil(w / 2 / pxPerDeg / 5) + 1) * 5; // keep marks on the 5° grid
  const marks: number[] = [];
  const base = Math.round(heading / 5) * 5;
  for (let d = base - reach; d <= base + reach; d += 5) marks.push(d);
  const compass = (deg: number) => {
    const n = ((deg % 360) + 360) % 360;
    return ({ 0: "N", 90: "E", 180: "S", 270: "W" } as Record<number, string>)[n] ?? String(n);
  };
  return (
    <g>
      <rect x={x} y={y} width={w} height={hh} rx={8} fill="url(#pfd-tape)" stroke="rgba(244,242,236,0.16)" />
      <clipPath id="hdg-clip"><rect x={x} y={y} width={w} height={hh} rx={8} /></clipPath>
      <g clipPath="url(#hdg-clip)">
        {has && marks.map((m) => {
          const px = midX + (m - heading) * pxPerDeg;
          const major = ((m % 30) + 30) % 30 === 0;
          const cardinal = ((m % 90) + 90) % 90 === 0;
          return (
            <g key={m}>
              <line x1={px} x2={px} y1={y + 4} y2={y + (major ? 22 : 13)} stroke={major ? "#f4f2ec" : "#b8c0cf"} strokeWidth={major ? 2 : 1} opacity={major ? 1 : 0.7} />
              {major && <text x={px} y={y + 44} textAnchor="middle" fontSize={cardinal ? 19 : 15} fontWeight={cardinal ? 600 : 400} fill={cardinal ? "#f4a259" : "#dde2ea"} fontFamily="var(--font-display)">{compass(m)}</text>}
            </g>
          );
        })}
      </g>
      <polygon points={`${midX},${y + 1} ${midX - 14},${y - 14} ${midX + 14},${y - 14}`} fill="#f4a259" />
      <rect x={midX - 34} y={y - 42} width={68} height={28} rx={5} fill="#0b1428" stroke="#f4a259" strokeWidth={1.6} />
      <text x={midX} y={y - 22} textAnchor="middle" fontSize={18} fontWeight={600} fill="#f4f2ec" fontFamily="var(--font-display)">{has ? `${Math.round(((heading % 360) + 360) % 360)}°` : "—"}</text>
    </g>
  );
}
