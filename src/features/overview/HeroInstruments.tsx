import { useEffect, useRef } from "react";
import { RAD } from "../../utils/format";
import { heroState } from "./heroMotion";

/*
  Instrument cluster over the hero. Updated imperatively every animation frame
  from the same state that positions the 3D aircraft, so React never re-renders.
*/

const AI = 168; // attitude indicator diameter
const PX_PER_DEG = 3.2;
const TAPE_W = 232;
const TAPE_PX_PER_DEG = 2.4;

function PitchLadder() {
  const lines = [];
  for (let d = -40; d <= 40; d += 5) {
    if (d === 0) continue;
    const y = -d * PX_PER_DEG;
    const major = d % 10 === 0;
    const w = major ? 44 : 22;
    lines.push(
      <g key={d}>
        <line x1={-w / 2} x2={w / 2} y1={y} y2={y} stroke="#14213d" strokeOpacity={major ? 0.85 : 0.5} strokeWidth={1.2} />
        {major && (
          <>
            <text x={-w / 2 - 6} y={y + 3.5} textAnchor="end" className="ai-num">
              {Math.abs(d)}
            </text>
            <text x={w / 2 + 6} y={y + 3.5} textAnchor="start" className="ai-num">
              {Math.abs(d)}
            </text>
          </>
        )}
      </g>,
    );
  }
  return <>{lines}</>;
}

function HeadingTicks() {
  const items = [];
  const card: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
  for (let d = -360; d <= 720; d += 5) {
    const x = d * TAPE_PX_PER_DEG;
    const n = ((d % 360) + 360) % 360;
    const major = n % 30 === 0;
    items.push(<line key={`t${d}`} x1={x} x2={x} y1={major ? 14 : 18} y2={24} stroke="#33405c" strokeOpacity={major ? 0.9 : 0.45} />);
    if (major)
      items.push(
        <text key={`n${d}`} x={x} y={10} textAnchor="middle" className={card[n] ? "tape-card" : "tape-num"}>
          {card[n] ?? n / 10}
        </text>,
      );
  }
  return <>{items}</>;
}

export function HeroInstruments({ animate }: { animate: boolean }) {
  const horizon = useRef<SVGGElement>(null);
  const rollPtr = useRef<SVGGElement>(null);
  const tape = useRef<SVGGElement>(null);
  const hdg = useRef<HTMLSpanElement>(null);
  const agl = useRef<HTMLSpanElement>(null);
  const gs = useRef<HTMLSpanElement>(null);
  const vs = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const s = heroState;
      const roll = s.roll * RAD;
      const pitch = s.pitch * RAD;
      const heading = ((s.yaw * RAD) % 360 + 360) % 360;
      horizon.current?.setAttribute("transform", `rotate(${-roll}) translate(0 ${pitch * PX_PER_DEG})`);
      rollPtr.current?.setAttribute("transform", `rotate(${-roll})`);
      tape.current?.setAttribute("transform", `translate(${TAPE_W / 2 - heading * TAPE_PX_PER_DEG} 0)`);
      if (hdg.current) hdg.current.textContent = String(Math.round(heading)).padStart(3, "0");
      if (agl.current) agl.current.textContent = s.agl.toFixed(1);
      if (gs.current) gs.current.textContent = s.groundSpeed.toFixed(1);
      if (vs.current) vs.current.textContent = (s.climb >= 0 ? "+" : "") + s.climb.toFixed(2);
      if (animate) raf = requestAnimationFrame(draw);
    };
    // Even when still, draw once after the scene has positioned the aircraft
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const r = AI / 2;
  return (
    <div className="hero-instruments" aria-label="Preview flight instruments">
      <svg className="tape" width={TAPE_W} height={28} viewBox={`0 0 ${TAPE_W} 28`} aria-hidden>
        <defs>
          <linearGradient id="tapeFade" x1="0" x2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.18" stopColor="#fff" stopOpacity="1" />
            <stop offset="0.82" stopColor="#fff" stopOpacity="1" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="tapeMask">
            <rect width={TAPE_W} height={28} fill="url(#tapeFade)" />
          </mask>
        </defs>
        <g mask="url(#tapeMask)">
          <g ref={tape}>
            <HeadingTicks />
          </g>
        </g>
        <path d={`M${TAPE_W / 2 - 5} 28 L${TAPE_W / 2} 21 L${TAPE_W / 2 + 5} 28 Z`} fill="#a8470f" />
      </svg>

      <svg className="ai" width={AI} height={AI} viewBox={`${-r} ${-r} ${AI} ${AI}`} aria-hidden>
        <defs>
          <clipPath id="aiClip">
            <circle r={r - 2} />
          </clipPath>
        </defs>
        <g clipPath="url(#aiClip)">
          <g ref={horizon}>
            <rect x={-AI * 2} y={-AI * 2} width={AI * 4} height={AI * 2} fill="#c9dced" />
            <rect x={-AI * 2} y={0} width={AI * 4} height={AI * 2} fill="#c8bca4" />
            <line x1={-AI * 2} x2={AI * 2} y1={0} y2={0} stroke="#14213d" strokeWidth={1.5} />
            <PitchLadder />
          </g>
          {/* Roll scale */}
          {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map((a) => {
            const big = a % 30 === 0;
            const rad = ((a - 90) * Math.PI) / 180;
            const r1 = r - 3;
            const r2 = r - (big ? 13 : 9);
            return (
              <line
                key={a}
                x1={Math.cos(rad) * r1}
                y1={Math.sin(rad) * r1}
                x2={Math.cos(rad) * r2}
                y2={Math.sin(rad) * r2}
                stroke="#14213d"
                strokeOpacity={0.8}
                strokeWidth={1.3}
              />
            );
          })}
          <g ref={rollPtr}>
            <path d={`M0 ${-r + 14} l-5 8 h10 z`} fill="#a8470f" />
          </g>
        </g>
        {/* Fixed aircraft symbol */}
        <g stroke="#a8470f" strokeWidth={3} strokeLinecap="round" fill="none">
          <path d="M-46 0 H-18 L-10 8" />
          <path d="M46 0 H18 L10 8" />
        </g>
        <circle r={3} fill="#a8470f" />
        <circle r={r - 1} fill="none" stroke="rgba(20,33,61,0.22)" strokeWidth={2} />
      </svg>

      <dl className="hero-readouts">
        <div>
          <dt>Heading</dt>
          <dd>
            <span ref={hdg}>000</span>
            <small>°</small>
          </dd>
        </div>
        <div>
          <dt>Height above ground</dt>
          <dd>
            <span ref={agl}>0.0</span>
            <small>m</small>
          </dd>
        </div>
        <div>
          <dt>Ground speed</dt>
          <dd>
            <span ref={gs}>0.0</span>
            <small>m/s</small>
          </dd>
        </div>
        <div>
          <dt>Climb</dt>
          <dd>
            <span ref={vs}>0.00</span>
            <small>m/s</small>
          </dd>
        </div>
      </dl>
      <p className="hero-disclaimer">Scripted preview flight. Not live telemetry.</p>
    </div>
  );
}
