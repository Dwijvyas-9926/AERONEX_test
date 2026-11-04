import type { LucideIcon } from "lucide-react";
import { Activity, Box, Cable, Crosshair, Drone, Gamepad2, Gauge, Info, ListTree, Plane, Route, ScrollText, Settings, ShieldCheck, SlidersVertical } from "lucide-react";

/**
 * Build status per module, shown in the navigation so nothing pretends to exist.
 *  - ready: works end to end for its current scope
 *  - partial: real and usable, with documented gaps
 *  - planned: screen explains what is coming and in which phase
 */
export type BuildStatus = { kind: "ready" } | { kind: "partial"; note: string } | { kind: "planned"; phase: number };

export interface RouteDef {
  path: string;
  label: string;
  icon: LucideIcon;
  group: "Workspace" | "Aircraft" | "Flight" | "Analysis" | "System";
  status: BuildStatus;
  blurb: string;
}

export const ROUTES: RouteDef[] = [
  { path: "/", label: "Overview", icon: Gauge, group: "Workspace", status: { kind: "ready" }, blurb: "Your aircraft, link and readiness at a glance." },
  {
    path: "/connection",
    label: "Vehicle Connection",
    icon: Cable,
    group: "Aircraft",
    status: { kind: "partial", note: "USB / radio link" },
    blurb: "Connect a Pixhawk over USB or a telemetry radio.",
  },
  { path: "/digital-twin", label: "Digital Twin Studio", icon: Box, group: "Aircraft", status: { kind: "partial", note: "Import + test flight" }, blurb: "Import your assembly, orient it and test-fly it." },
  { path: "/calibration", label: "Calibration Center", icon: Crosshair, group: "Aircraft", status: { kind: "partial", note: "Live on hardware" }, blurb: "Accel, compass, radio, modes, ESC and motor test." },
  { path: "/pid", label: "PID Tuning", icon: SlidersVertical, group: "Aircraft", status: { kind: "partial", note: "Live gains" }, blurb: "Calm horizontal and vertical wobble, with a tuning advisor." },
  { path: "/params", label: "Full Parameters", icon: ListTree, group: "Aircraft", status: { kind: "partial", note: "Read / write" }, blurb: "Search and edit every autopilot parameter, then upload." },
  { path: "/vehicle", label: "Vehicle Configuration", icon: Drone, group: "Aircraft", status: { kind: "ready" }, blurb: "Profiles for each aircraft you fly." },
  { path: "/flight-data", label: "Flight Data", icon: Plane, group: "Flight", status: { kind: "partial", note: "Live PFD" }, blurb: "A full primary flight display from live telemetry." },
  { path: "/preflight", label: "Preflight Check", icon: ShieldCheck, group: "Flight", status: { kind: "partial", note: "Live health" }, blurb: "Pre-arm, EKF, GPS, vibration and battery go/no-go." },
  { path: "/simulator", label: "Flight Simulator", icon: Gamepad2, group: "Flight", status: { kind: "ready" }, blurb: "Fly your aircraft in a 3D valley, no hardware." },
  { path: "/missions", label: "Mission Planning", icon: Route, group: "Flight", status: { kind: "planned", phase: 7 }, blurb: "Waypoints, survey grids and relief-drop missions." },
  {
    path: "/telemetry",
    label: "Telemetry & Diagnostics",
    icon: Activity,
    group: "Analysis",
    status: { kind: "partial", note: "Live link data" },
    blurb: "Message rates, events and raw protocol traffic.",
  },
  { path: "/logs", label: "Flight Logs", icon: ScrollText, group: "Analysis", status: { kind: "planned", phase: 7 }, blurb: "Analyse ArduPilot .bin and PX4 .ulg logs." },
  { path: "/about", label: "About", icon: Info, group: "System", status: { kind: "ready" }, blurb: "What AERONEX is, how to use it, and who made it." },
  { path: "/settings", label: "Settings", icon: Settings, group: "System", status: { kind: "ready" }, blurb: "Display, motion, units and graphics quality." },
];

export const routeFor = (path: string) => ROUTES.find((r) => r.path === path) ?? ROUTES[0];
