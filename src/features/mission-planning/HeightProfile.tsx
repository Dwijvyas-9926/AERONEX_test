import { CircleCheck, TriangleAlert } from "lucide-react";
import type { RouteProfile } from "../../geo/profile";

/** Below this the route is called out: closer than the ground data can be trusted. */
export const CLEAR_WARN = 15;

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);

/*
  The route from the side. Distance runs left to right; the filled shape is
  the ground and the line is the flight. Where the two come closest is marked,
  because that, and not any single waypoint, is what decides whether the
  route is safe.
*/
export function HeightProfile({ profile, real, loading }: { profile: RouteProfile; real: boolean; loading?: boolean }) {
  const { samples, lowest, legs, length } = profile;
  if (!samples.length || !lowest) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    lo = Math.min(lo, s.ground, s.fly);
    hi = Math.max(hi, s.ground, s.fly);
  }
  const pad = Math.max(4, (hi - lo) * 0.12);
  lo -= pad;
  hi += pad;
  const W = 1000;
  const H = 240;
  const x = (d: number) => (d / Math.max(1, length)) * W;
  const y = (h: number) => H - ((h - lo) / (hi - lo)) * H;
  const groundPath = `M0,${H} ${samples.map((s) => `L${x(s.d).toFixed(1)},${y(s.ground).toFixed(1)}`).join(" ")} L${W},${H} Z`;
  const flyPath = samples.map((s, i) => `${i ? "L" : "M"}${x(s.d).toFixed(1)},${y(s.fly).toFixed(1)}`).join(" ");

  const leg = legs[lowest.leg];
  const where = leg ? (leg.from === leg.to ? `at waypoint ${leg.to}` : `between ${leg.from === "Home" ? "home" : `waypoint ${leg.from}`} and ${leg.to === "Home" ? "home" : `waypoint ${leg.to}`}`) : "";
  const tone = lowest.clear < 0 ? "bad" : lowest.clear < CLEAR_WARN ? "warn" : "ok";

  return (
    <div className={`hprof ${tone}`}>
      <div className="hprof-say">
        {tone === "ok" ? <CircleCheck aria-hidden /> : <TriangleAlert aria-hidden />}
        <p>
          {lowest.clear < 0 ? (
            <>
              <strong>The route goes {Math.round(-lowest.clear)} m into the ground</strong> {where}, {km(lowest.d)} along. The autopilot flies a straight line between waypoints and does not know the ground is there. Raise the waypoints either side, or add one over the high ground.
            </>
          ) : lowest.clear < CLEAR_WARN ? (
            <>
              <strong>Only {Math.round(lowest.clear)} m above the ground</strong> {where}, {km(lowest.d)} along. {real ? "The ground heights are good to about 10 m and know nothing of trees or buildings, so this is not a safe margin." : "Leave more room."}
            </>
          ) : (
            <>
              <strong>At least {Math.round(lowest.clear)} m above the ground all the way.</strong> The closest point is {where}, {km(lowest.d)} along.{real ? " Trees, buildings and wires are not in the data: add their height yourself." : ""}
            </>
          )}
        </p>
      </div>
      <div className="hprof-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Height of the route and of the ground along ${km(length)}. Closest approach ${Math.round(lowest.clear)} metres.`}>
          {lo < 0 && hi > 0 && <line className="hprof-zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
          <path className="hprof-ground" d={groundPath} />
          {legs.slice(0, -1).map((l) => (
            <line key={l.endD} className="hprof-wp" x1={x(l.endD)} x2={x(l.endD)} y1={0} y2={H} />
          ))}
          <path className="hprof-fly" d={flyPath} />
          <line className="hprof-low" x1={x(lowest.d)} x2={x(lowest.d)} y1={y(lowest.fly)} y2={y(lowest.ground)} />
        </svg>
        <span className="hprof-y top">{Math.round(hi)} m</span>
        <span className="hprof-y bottom">{Math.round(lo)} m</span>
        {legs.slice(0, -1).map((l) => (
          <span key={l.endD} className="hprof-tick" style={{ left: `${(l.endD / length) * 100}%` }}>
            {l.to}
          </span>
        ))}
      </div>
      <div className="hprof-foot">
        <span><i className="hprof-key fly" /> Flight</span>
        <span><i className="hprof-key ground" /> Ground{real ? " (measured)" : ""}</span>
        <span>Heights are above home</span>
        <span>{km(length)}</span>
        {loading && <span className="hprof-loading">Loading ground heights…</span>}
      </div>
    </div>
  );
}
