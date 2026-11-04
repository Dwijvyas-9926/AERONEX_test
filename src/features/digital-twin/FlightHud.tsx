import { useEffect, useRef } from "react";
import { RAD } from "../../utils/format";
import { livePose } from "./testFlight";

/* Flight HUD for the test-flight modes, updated imperatively from livePose. */
export function FlightHud({ active }: { active: boolean }) {
  const spd = useRef<HTMLSpanElement>(null);
  const alt = useRef<HTMLSpanElement>(null);
  const vs = useRef<HTMLSpanElement>(null);
  const hdg = useRef<HTMLSpanElement>(null);
  const horizon = useRef<SVGGElement>(null);
  const roll = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const draw = () => {
      const p = livePose;
      if (spd.current) spd.current.textContent = p.groundSpeed.toFixed(1);
      if (alt.current) alt.current.textContent = p.agl.toFixed(1);
      if (vs.current) vs.current.textContent = (p.climb >= 0 ? "+" : "") + p.climb.toFixed(1);
      if (hdg.current) hdg.current.textContent = String(Math.round((((p.yaw * RAD) % 360) + 360) % 360)).padStart(3, "0");
      horizon.current?.setAttribute("transform", `rotate(${-p.roll * RAD}) translate(0 ${p.pitch * RAD * 2})`);
      roll.current?.setAttribute("transform", `rotate(${-p.roll * RAD})`);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  if (!active) return null;
  const r = 44;
  return (
    <div className="flight-hud">
      <svg width="92" height="92" viewBox="-46 -46 92 92" aria-hidden>
        <defs>
          <clipPath id="hud-ai">
            <circle r={r - 1} />
          </clipPath>
        </defs>
        <g clipPath="url(#hud-ai)">
          <g ref={horizon}>
            <rect x={-120} y={-120} width={240} height={120} fill="#bfae90" />
            <rect x={-120} y={0} width={240} height={120} fill="#2c1f14" />
            <line x1={-120} x2={120} y1={0} y2={0} stroke="#f2e8d6" strokeWidth={1.2} />
          </g>
          <g ref={roll}>
            <path d="M0 -43 l-4 7 h8 z" fill="#d8a648" />
          </g>
        </g>
        <g stroke="#d8a648" strokeWidth={2.4} fill="none" strokeLinecap="round">
          <path d="M-22 0 H-8 L-4 5" />
          <path d="M22 0 H8 L4 5" />
        </g>
        <circle r={2} fill="#d8a648" />
        <circle r={r - 1} fill="none" stroke="rgba(242,232,214,0.25)" strokeWidth={1.5} />
      </svg>
      <dl>
        <div>
          <dt>Speed</dt>
          <dd>
            <span ref={spd} className="num">0.0</span> <small>m/s</small>
          </dd>
        </div>
        <div>
          <dt>Height</dt>
          <dd>
            <span ref={alt} className="num">1.2</span> <small>m</small>
          </dd>
        </div>
        <div>
          <dt>Climb</dt>
          <dd>
            <span ref={vs} className="num">+0.0</span> <small>m/s</small>
          </dd>
        </div>
        <div>
          <dt>Heading</dt>
          <dd>
            <span ref={hdg} className="num">000</span>
            <small>°</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}
