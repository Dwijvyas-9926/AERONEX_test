import { create } from "zustand";
import { distanceM, type LatLon } from "../../geo/geo";
import { useLink } from "../../state/linkStore";
import { notify } from "../../state/notifyStore";
import { useSim } from "../../state/simStore";
import { commandLink } from "./commandLink";

/*
  Home comes from the aircraft.

  ArduPilot decides where home is: where the GPS first gets a position, and
  again where the aircraft arms. A mission's heights are counted from there
  and a return home goes there, whatever a ground station has drawn. Mission
  Planner shows that home; QGroundControl keeps a separate "planned home" for
  drawing with no aircraft, and the real one once it flies.

  So here: with no aircraft, home is where the reader put it. As soon as a
  real aircraft is linked and its GPS has a position, home is the aircraft's,
  and stays the aircraft's until it is unlinked. The waypoints stay where they
  are on the ground. Nothing to press.

  The computer's own location plays no part: the aircraft may be at the far
  end of a radio link.
*/
export interface AircraftView {
  connected: boolean;
  virtual: boolean;
  armed: boolean;
  /** GPS_RAW_INT fix type: 3 and up is a 3D position. */
  fix: number | null;
  position: LatLon | null;
  /** HOME_POSITION, as the aircraft reports it. */
  home: (LatLon & { altMsl: number }) | null;
}

const real = (p: LatLon | null): p is LatLon => !!p && (p.lat !== 0 || p.lon !== 0) && Math.abs(p.lat) <= 90;

/**
 * Where the aircraft's home is, as far as can be told.
 *
 * Its own report is the answer. Until one arrives, home is where the GPS
 * first had a position while the aircraft sat disarmed, which is what
 * ArduPilot itself uses; `first` carries that between calls. An aircraft
 * already armed when it is linked may be anywhere, so nothing is assumed.
 */
export function aircraftHome(a: AircraftView, first: LatLon | null): { home: (LatLon & { altMsl?: number }) | null; first: LatLon | null } {
  if (!a.connected || a.virtual) return { home: null, first: null };
  let latched = first;
  if (!latched && !a.armed && a.fix !== null && a.fix >= 3 && real(a.position)) latched = { lat: a.position.lat, lon: a.position.lon };
  if (a.home && real(a.home)) return { home: a.home, first: latched };
  return { home: latched, first: latched };
}

interface HomeSource {
  /** "you": placed by hand. "waiting": an aircraft is linked but has no position yet. "aircraft": it is the aircraft's. */
  source: "you" | "waiting" | "aircraft";
  /** Goes up each time home is first taken from an aircraft, so a map can go there. */
  taken: number;
}

export const useHomeSource = create<HomeSource>(() => ({ source: "you", taken: 0 }));

let started = false;

/** Starts following. Safe to call more than once. */
export function startHomeFollow() {
  if (started) return;
  started = true;
  let first: LatLon | null = null;
  let asked = 0;
  let wasConnected = false;

  const look = () => {
    const l = useLink.getState();
    const connected = l.status === "connected";
    if (!connected || l.virtual) {
      first = null;
      wasConnected = false;
      if (useHomeSource.getState().source !== "you") useHomeSource.setState({ source: "you" });
      return;
    }
    // The aircraft only reports home when asked, or when it changes. Ask on linking, and again now and then until it answers.
    const now = Date.now();
    if (!l.telemetry.home && now - asked > 5000) {
      asked = now;
      void commandLink.requestMessageInterval(242, 0.5);
    }
    wasConnected = true;
    const p = l.telemetry.position?.value;
    const got = aircraftHome(
      { connected, virtual: l.virtual, armed: l.vehicle?.armed ?? false, fix: l.telemetry.gps?.value.fixType ?? null, position: p ? { lat: p.lat, lon: p.lon } : null, home: l.telemetry.home?.value ?? null },
      first,
    );
    first = got.first;
    const src = useHomeSource.getState();
    if (!got.home) {
      if (src.source !== "waiting") useHomeSource.setState({ source: "waiting" });
      return;
    }
    const sim = useSim.getState();
    const moved = distanceM(sim.home, got.home);
    const firstTime = src.source !== "aircraft";
    // GPS wanders a metre or two at rest: home is not chased around for that.
    if (moved > 3 || (firstTime && moved > 0.5)) sim.followHome(got.home, got.home.altMsl);
    if (firstTime) {
      useHomeSource.setState({ source: "aircraft", taken: src.taken + 1 });
      notify("success", "Home is the aircraft's GPS position", moved > 30 ? `Home moved ${moved >= 1000 ? `${(moved / 1000).toFixed(1)} km` : `${Math.round(moved)} m`} to where the aircraft is.${sim.points.length ? " Your waypoints are where they were on the ground: check they are still the ones you want." : ""}` : "It will follow the aircraft for as long as it is linked.");
    } else if (moved > 20) {
      notify("info", "The aircraft moved its home", `Home is now ${Math.round(moved)} m from where it was. ArduPilot sets home again where the aircraft arms.`);
    }
  };
  useLink.subscribe(look);
  // A link that is up but quiet still needs the request for home repeated.
  setInterval(() => wasConnected && look(), 3000);
}
