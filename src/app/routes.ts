import type { LucideIcon } from "lucide-react";
import { Activity, Box, Cable, Crosshair, Drone, Gamepad2, Gauge, Info, Keyboard, ListTree, Plane, Route, ScrollText, Settings, ShieldCheck, SlidersVertical, Stethoscope } from "lucide-react";

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
  group: "Workspace" | "Setup" | "Tune & Configure" | "Flight" | "Analysis" | "System";
  status: BuildStatus;
  blurb: string;
}

// Ordered to follow the real workflow: set up the aircraft → tune & configure
// it → fly it → analyse it. Array order is also the order shown in the sidebar.
export const ROUTES: RouteDef[] = [
  { path: "/", label: "Overview", icon: Gauge, group: "Workspace", status: { kind: "ready" }, blurb: "Your aircraft, link and readiness at a glance." },

  // Setup — define the aircraft and get connected.
  { path: "/vehicle", label: "Aircraft Profile", icon: Drone, group: "Setup", status: { kind: "ready" }, blurb: "Describe each aircraft you fly — frame, controller and mass." },
  { path: "/connection", label: "Vehicle Connection", icon: Cable, group: "Setup", status: { kind: "partial", note: "USB / radio link" }, blurb: "Connect a Pixhawk over USB or a telemetry radio." },
  { path: "/digital-twin", label: "Digital Twin Studio", icon: Box, group: "Setup", status: { kind: "partial", note: "Import + test flight" }, blurb: "Import your assembly, orient it and test-fly it." },

  // Tune & Configure — calibrate, tune and edit parameters.
  { path: "/calibration", label: "Calibration Center", icon: Crosshair, group: "Tune & Configure", status: { kind: "partial", note: "Live on hardware" }, blurb: "Accel, compass, radio, modes, ESC and motor test." },
  { path: "/pid", label: "PID Tuning", icon: SlidersVertical, group: "Tune & Configure", status: { kind: "partial", note: "Live gains" }, blurb: "Calm horizontal and vertical wobble, with a tuning advisor." },
  { path: "/params", label: "Full Parameters", icon: ListTree, group: "Tune & Configure", status: { kind: "partial", note: "Read / write" }, blurb: "Search and edit every autopilot parameter, then upload." },

  // Flight — check, rehearse and fly.
  { path: "/preflight", label: "Preflight Check", icon: ShieldCheck, group: "Flight", status: { kind: "partial", note: "Live health" }, blurb: "Pre-arm, EKF, GPS, vibration and battery go/no-go." },
  { path: "/flight-data", label: "Flight Data", icon: Plane, group: "Flight", status: { kind: "partial", note: "Live PFD" }, blurb: "A full primary flight display from live telemetry." },
  { path: "/keyboard-flight", label: "Keyboard Flight", icon: Keyboard, group: "Flight", status: { kind: "partial", note: "Live guided control" }, blurb: "Fly a real test hop from the keyboard — no RC needed." },
  { path: "/simulator", label: "Flight Simulator", icon: Gamepad2, group: "Flight", status: { kind: "ready" }, blurb: "Fly your aircraft in a 3D valley, no hardware." },
  { path: "/missions", label: "Mission Planning", icon: Route, group: "Flight", status: { kind: "planned", phase: 7 }, blurb: "Waypoints, survey grids and relief-drop missions." },

  // Analysis — diagnose and review.
  { path: "/doctor", label: "Drone Doctor", icon: Stethoscope, group: "Analysis", status: { kind: "partial", note: "Live diagnosis" }, blurb: "Automated diagnosis of sensor, power and estimator faults, with recommended fixes." },
  { path: "/telemetry", label: "Telemetry & Diagnostics", icon: Activity, group: "Analysis", status: { kind: "partial", note: "Live link data" }, blurb: "Message rates, events and raw protocol traffic." },
  { path: "/logs", label: "Flight Logs", icon: ScrollText, group: "Analysis", status: { kind: "planned", phase: 7 }, blurb: "Analyse ArduPilot .bin and PX4 .ulg logs." },

  // System
  { path: "/about", label: "About", icon: Info, group: "System", status: { kind: "ready" }, blurb: "What AERONEX is, how to use it, and who made it." },
  { path: "/settings", label: "Settings", icon: Settings, group: "System", status: { kind: "ready" }, blurb: "Display, motion, units and graphics quality." },
];

export const routeFor = (path: string) => ROUTES.find((r) => r.path === path) ?? ROUTES[0];
