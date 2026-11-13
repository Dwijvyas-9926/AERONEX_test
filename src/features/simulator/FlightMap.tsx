import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Terrain } from "../../sim/terrain";

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
  /** The landscape, shaded under the grid. */
  terrain?: Terrain | null;
}

/** The ground as a picture: green low, brown high, lit from the north-west, water blue. */
function relief(terrain: Terrain, cn: number, ce: number, span: number): string {
  const N = 150;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(N, N);
  const cell = (span * 2) / N;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const e = ce - span + (i + 0.5) * cell;
      const n = cn + span - (j + 0.5) * cell;
      const h = terrain.land(n, e);
      const k = (j * N + i) * 4;
      if (h < terrain.waterLevel) {
        img.data.set([34, 66, 86, 255], k);
        continue;
      }
      const light = Math.max(-1, Math.min(1, ((terrain.land(n + cell, e - cell) - h) / cell) * 2.2));
      const t = Math.min(1, h / 90);
      const s = 1 + light * 0.45;
      img.data.set([(34 + 58 * t) * s, (46 + 30 * t) * s, (24 + 14 * t) * s, 255], k);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

const niceStep = (span: number) => {
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
};

export function FlightMap({ route = [], closeRoute, track = [], ghost = [], aircraft, fenceRadius, wind, mark, onPick, minSpan = 60, terrain }: Props) {
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

  /*
    The view: fitted to the route until the reader takes hold of it. Scrolling
    zooms about the pointer, dragging moves the map, and Fit hands it back.
    Without this a waypoint could only be placed inside whatever the map
    happened to be showing.
  */
  const [view, setView] = useState<{ n: number; e: number; half: number } | null>(null);
  const half = view?.half ?? span;
  const cn = view?.n ?? 0;
  const ce = view?.e ?? 0;
  const live = useRef({ half, cn, ce });
  live.current = { half, cn, ce };
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const MIN = 12;
  const MAX = 25000;

  /** Metres per screen pixel: the drawing is square and fitted inside the element. */
  const scale = () => {
    const r = ref.current?.getBoundingClientRect();
    return r ? (live.current.half * 2) / Math.max(1, Math.min(r.width, r.height)) : 1;
  };
  const toWorld = (x: number, y: number) => {
    const svg = ref.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const p = pt.matrixTransform(m.inverse());
    return { n: -p.y, e: p.x };
  };
  const zoomBy = (f: number, about?: { n: number; e: number }) => {
    const c = live.current;
    const next = Math.min(MAX, Math.max(MIN, c.half * f));
    const k = next / c.half;
    const a = about ?? { n: c.cn, e: c.ce };
    // The point under the pointer stays under the pointer.
    setView({ n: a.n + (c.cn - a.n) * k, e: a.e + (c.ce - a.e) * k, half: next });
  };

  // React attaches wheel listeners as passive, which cannot stop the page scrolling.
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      zoomBy(ev.deltaY > 0 ? 1.2 : 1 / 1.2, toWorld(ev.clientX, ev.clientY) ?? undefined);
    };
    svg.addEventListener("wheel", wheel, { passive: false });
    return () => svg.removeEventListener("wheel", wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The open field is level near home, but its horizon is mountains: once the view reaches them they are drawn,
  // because the aircraft can fly into them.
  const shaded = useMemo(() => (terrain && (terrain.kind !== "flat" || Math.hypot(cn, ce) + half * 1.42 > 1300) ? relief(terrain, cn, ce, half) : null), [terrain, cn, ce, half]);
  const step = niceStep(half);
  const east: number[] = [];
  const north: number[] = [];
  for (let v = Math.ceil((ce - half) / step) * step; v <= ce + half + 1e-6; v += step) east.push(Math.round(v * 1000) / 1000);
  for (let v = Math.ceil((cn - half) / step) * step; v <= cn + half + 1e-6; v += step) north.push(Math.round(v * 1000) / 1000);
  // SVG x is east; SVG y is south, so north is negated once here.
  const path = (pts: MapPoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.e.toFixed(1)},${(-p.n).toFixed(1)}`).join(" ");
  const u = half / 100; // one "percent" of the half-view, for sizes that should not scale with zoom
  const fullRoute = [{ n: 0, e: 0 }, ...route, ...(closeRoute && route.length ? [{ n: 0, e: 0 }] : [])];

  const pick = (ev: React.MouseEvent) => {
    // The end of a drag is not a click.
    if (drag.current?.moved) return;
    if (!onPick) return;
    const p = toWorld(ev.clientX, ev.clientY);
    if (p) onPick(p.n, p.e);
  };

  return (
    <div className={`fmap${onPick ? " pickable" : ""}`}>
      <svg
        ref={ref}
        viewBox={`${ce - half} ${-cn - half} ${half * 2} ${half * 2}`}
        onClick={pick}
        onPointerDown={(ev) => {
          drag.current = { x: ev.clientX, y: ev.clientY, moved: false };
        }}
        onPointerMove={(ev) => {
          const d = drag.current;
          if (!d || ev.buttons === 0) return;
          const dx = ev.clientX - d.x;
          const dy = ev.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 5) return;
          if (!d.moved) ev.currentTarget.setPointerCapture(ev.pointerId);
          d.moved = true;
          d.x = ev.clientX;
          d.y = ev.clientY;
          const k = scale();
          const c = live.current;
          setView({ n: c.cn + dy * k, e: c.ce - dx * k, half: c.half });
        }}
        onPointerUp={() => {
          // Cleared after the click that follows, which reads it.
          window.setTimeout(() => (drag.current = null), 0);
        }}
        role="img"
        aria-label="Plan view of the flight, north up"
      >
        {shaded && <image href={shaded} x={ce - half} y={-cn - half} width={half * 2} height={half * 2} preserveAspectRatio="none" opacity={0.9} />}
        <g className="fmap-grid">
          {east.map((v) => (
            <line key={`e${v}`} x1={v} y1={-cn - half} x2={v} y2={-cn + half} className={v === 0 ? "axis" : undefined} />
          ))}
          {north.map((v) => (
            <line key={`n${v}`} x1={ce - half} y1={-v} x2={ce + half} y2={-v} className={v === 0 ? "axis" : undefined} />
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
      <div className="fmap-zoom" role="group" aria-label="Map zoom">
        <button onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom in" data-tip="Zoom in" disabled={half <= MIN}>
          <Plus />
        </button>
        <button onClick={() => zoomBy(1.5)} aria-label="Zoom out" data-tip="Zoom out" disabled={half >= MAX}>
          <Minus />
        </button>
        <button onClick={() => setView(null)} aria-label="Fit the route" data-tip="Show the whole route" disabled={!view}>
          <Maximize />
        </button>
      </div>
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
        <span>{half >= 1000 ? `${((half * 2) / 1000).toFixed(1)} km` : `${Math.round(half * 2)} m`} across</span>
        <span className="fmap-hint">{onPick ? "Click to add a waypoint. Scroll to zoom, drag to move." : "Scroll to zoom, drag to move."}</span>
      </div>
    </div>
  );
}
