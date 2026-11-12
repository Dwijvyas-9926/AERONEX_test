import { useMemo, useRef } from "react";

/*
  A plan view in metres, north up, with home at the origin.

  Drawn to scale on a grid rather than on map tiles: the simulator's world has
  no terrain or buildings, and a satellite photo under it would suggest it
  knew about them.
*/
export interface MapPoint {
  n: number;
  e: number;
}

interface Props {
  /** Planned waypoints, in order. */
  route?: (MapPoint & { label: string; tag?: string })[];
  /** Draw the leg back to home after the last waypoint. */
  closeRoute?: boolean;
  /** Where the aircraft has been. */
  track?: MapPoint[];
  /** A second path, such as a predicted flight. */
  ghost?: MapPoint[];
  aircraft?: (MapPoint & { yawDeg: number }) | null;
  fenceRadius?: number | null;
  wind?: { speed: number; fromDeg: number } | null;
  /** A mark on the map, such as where a predicted flight ended. */
  mark?: (MapPoint & { label: string; tone: "ok" | "bad" }) | null;
  onPick?: (n: number, e: number) => void;
  /** Half-width of the view, m, at the least. */
  minSpan?: number;
}

const niceStep = (span: number) => {
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
};

export function FlightMap({ route = [], closeRoute, track = [], ghost = [], aircraft, fenceRadius, wind, mark, onPick, minSpan = 60 }: Props) {
  const ref = useRef<SVGSVGElement>(null);

  // Fit everything worth seeing, square, with room round the edge.
  const span = useMemo(() => {
    let far = minSpan;
    const see = (p: MapPoint) => {
      far = Math.max(far, Math.abs(p.n) * 1.18, Math.abs(p.e) * 1.18);
    };
    route.forEach(see);
    ghost.forEach(see);
    if (aircraft) see(aircraft);
    if (mark) see(mark);
    if (track.length) see(track[track.length - 1]);
    for (let i = 0; i < track.length; i += Math.max(1, Math.floor(track.length / 60))) see(track[i]);
    const step = niceStep(far);
    return Math.ceil(far / step) * step;
  }, [route, ghost, track, aircraft, mark, minSpan]);

  const step = niceStep(span);
  const lines: number[] = [];
  for (let v = -span; v <= span + 1e-6; v += step) lines.push(Math.round(v * 1000) / 1000);
  // SVG x is east; SVG y is south, so north is negated once here.
  const path = (pts: MapPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.e.toFixed(1)},${(-p.n).toFixed(1)}`).join(" ");
  const u = span / 100; // one "percent" of the half-view, for sizes that should not scale with zoom
  const fullRoute = [{ n: 0, e: 0 }, ...route, ...(closeRoute && route.length ? [{ n: 0, e: 0 }] : [])];

  const pick = (ev: React.MouseEvent) => {
    if (!onPick || !ref.current) return;
    const pt = ref.current.createSVGPoint();
    pt.x = ev.clientX;
    pt.y = ev.clientY;
    const m = ref.current.getScreenCTM();
    if (!m) return;
    const p = pt.matrixTransform(m.inverse());
    onPick(-p.y, p.x);
  };

  return (
    <div className={`fmap${onPick ? " pickable" : ""}`}>
      <svg ref={ref} viewBox={`${-span} ${-span} ${span * 2} ${span * 2}`} onClick={pick} role="img" aria-label="Plan view of the flight, north up">
        <g className="fmap-grid">
          {lines.map((v) => (
            <g key={v}>
              <line x1={v} y1={-span} x2={v} y2={span} className={v === 0 ? "axis" : undefined} />
              <line x1={-span} y1={v} x2={span} y2={v} className={v === 0 ? "axis" : undefined} />
            </g>
          ))}
        </g>
        {fenceRadius ? <circle className="fmap-fence" r={fenceRadius} /> : null}
        {fullRoute.length > 1 && <path className="fmap-route" d={path(fullRoute)} />}
        {ghost.length > 1 && <path className="fmap-ghost" d={path(ghost)} />}
        {track.length > 1 && <path className="fmap-track" d={path(track)} />}

        <g className="fmap-home">
          <circle r={u * 2.6} />
          <text y={u * 1.3} fontSize={u * 3.4} textAnchor="middle">
            H
          </text>
        </g>
        {route.map((p) => (
          <g key={p.label} className="fmap-wp" transform={`translate(${p.e} ${-p.n})`}>
            <circle r={u * 2.8} />
            <text y={u * 1.3} fontSize={u * 3.4} textAnchor="middle">
              {p.label}
            </text>
            {p.tag && (
              <text className="fmap-tag" x={u * 4} y={u * 1.2} fontSize={u * 3.2}>
                {p.tag}
              </text>
            )}
          </g>
        ))}
        {closeRoute && route.length > 0 && (
          <text className="fmap-tag" x={u * 4} y={u * 1.2} fontSize={u * 3.2}>
            Return and land
          </text>
        )}
        {mark && (
          <g className={`fmap-mark ${mark.tone}`} transform={`translate(${mark.e} ${-mark.n})`}>
            <path d={`M${-u * 2.4},${-u * 2.4} L${u * 2.4},${u * 2.4} M${u * 2.4},${-u * 2.4} L${-u * 2.4},${u * 2.4}`} strokeWidth={u * 0.9} />
            <text x={u * 3.6} y={u * 1.2} fontSize={u * 3.2}>
              {mark.label}
            </text>
          </g>
        )}
        {aircraft && (
          <g className="fmap-ac" transform={`translate(${aircraft.e} ${-aircraft.n}) rotate(${aircraft.yawDeg})`}>
            <path d={`M0,${-u * 4.4} L${u * 3},${u * 3.2} L0,${u * 1.6} L${-u * 3},${u * 3.2} Z`} strokeWidth={u * 0.4} />
          </g>
        )}
      </svg>
      <div className="fmap-legend">
        <span>
          <i className="fmap-north" aria-hidden /> North up
        </span>
        <span>Grid {step >= 1000 ? `${step / 1000} km` : `${step} m`}</span>
        {wind && wind.speed > 0 && (
          <span>
            <i className="fmap-wind" style={{ transform: `rotate(${wind.fromDeg + 180}deg)` }} aria-hidden /> Wind {wind.speed.toFixed(0)} m/s from {Math.round(wind.fromDeg)}°
          </span>
        )}
        {onPick && <span className="fmap-hint">Click the map to add a waypoint</span>}
      </div>
    </div>
  );
}
