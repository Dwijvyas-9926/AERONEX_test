import { useEffect, useRef, useState } from "react";

/*
  A decorative heads-up-display overlay for the hero: corner brackets, a scan
  sweep, an edge ruler, status chips and a live-ticking telemetry strip. Pure
  presentation (aria-hidden, pointer-events: none) sitting above the 3D canvas
  and below the headline. All motion is gated on `animate` (reduced-motion off).
*/

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function TelemetryStrip({ animate }: { animate: boolean }) {
  const [v, setV] = useState({ lat: 37.8041, lon: -122.417, alt: 34.2, hdg: 349, spd: 0.4 });
  const base = useRef(v);
  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => {
      const b = base.current;
      setV({
        lat: b.lat + rnd(-0.00008, 0.00008),
        lon: b.lon + rnd(-0.00008, 0.00008),
        alt: Math.max(0, b.alt + rnd(-0.15, 0.15)),
        hdg: (b.hdg + rnd(-1.2, 1.2) + 360) % 360,
        spd: Math.max(0, b.spd + rnd(-0.08, 0.08)),
      });
    }, 280);
    return () => clearInterval(id);
  }, [animate]);
  const cell = (label: string, val: string) => (
    <div className="hud-tel-cell">
      <span className="hud-tel-k">{label}</span>
      <span className="hud-tel-v">{val}</span>
    </div>
  );
  return (
    <div className="hero-hud-tel">
      <span className="hud-tel-tag">TELEMETRY · SIM</span>
      {cell("LAT", v.lat.toFixed(4))}
      {cell("LON", v.lon.toFixed(3))}
      {cell("ALT", `${v.alt.toFixed(1)} m`)}
      {cell("HDG", `${v.hdg.toFixed(0).padStart(3, "0")}°`)}
      {cell("SPD", `${v.spd.toFixed(1)} m/s`)}
    </div>
  );
}

export function HeroHud({ animate }: { animate: boolean }) {
  return (
    <div className={`hero-hud${animate ? " live" : ""}`} aria-hidden>
      <span className="hud-corner tl" />
      <span className="hud-corner tr" />
      <span className="hud-corner bl" />
      <span className="hud-corner br" />

      <div className="hero-hud-ruler">
        <span className="hud-ruler-caret" />
      </div>

      <TelemetryStrip animate={animate} />
    </div>
  );
}
