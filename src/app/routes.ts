import type { LucideIcon } from "lucide-react";
import { Activity, Box, Cable, Crosshair, Drone, Gamepad2, Gauge, Info, Keyboard, ListTree, PencilRuler, Plane, Route, ScrollText, Settings, ShieldCheck, SlidersVertical, Stethoscope } from "lucide-react";

/**
 * Build status per module, shown in the navigation so nothing pretends to exist.
 *  - ready: works end to end for its current scope
 *  - partial: real and usable, with documented gaps
 *  - planned: screen explains what is coming and in which phase
 */
export type BuildStatus = { kind: "ready" } | { kind: "partial"; note: string } | { kind: "planned"; phase: number };

export type RouteGroup = "Home" | "Design" | "Set up" | "Fly" | "Review" | "System";

export interface RouteDef {
  path: string;
  label: string;
  icon: LucideIcon;
  group: RouteGroup;
  status: BuildStatus;
  blurb: string;
  /** Other words someone might type when looking for this page. */
  find?: string;
}

/*
  The four stages of working on an aircraft, in the order they happen. The
  sidebar, the map on the Overview and the search all read from this, so the
  app describes itself the same way everywhere.
*/
export const STAGES: { group: RouteGroup; summary: string }[] = [
  { group: "Design", summary: "Draw the frame and see the aircraft before anything is built." },
  { group: "Set up", summary: "Link the flight controller, calibrate it and tune how it flies." },
  { group: "Fly", summary: "Check it is safe, rehearse, then fly and watch it live." },
  { group: "Review", summary: "Find out what went wrong, or confirm that nothing did." },
];

// Array order is the order shown in the sidebar.
export const ROUTES: RouteDef[] = [
  { path: "/", label: "Overview", icon: Gauge, group: "Home", status: { kind: "ready" }, blurb: "Your aircraft, link and next step at a glance.", find: "home dashboard start" },

  // Design — before anything is built.
  { path: "/frame-studio", label: "Frame Studio", icon: PencilRuler, group: "Design", status: { kind: "ready" }, blurb: "Design a frame around the parts you own and get files to cut or print.", find: "cad dxf stl print cut arms plates build" },
  { path: "/digital-twin", label: "Digital Twin", icon: Box, group: "Design", status: { kind: "partial", note: "Import + test flight" }, blurb: "Import your 3D model, set which way is forward and watch it move.", find: "3d model step glb import cad" },

  // Set up — get the real aircraft ready.
  { path: "/vehicle", label: "Aircraft Profile", icon: Drone, group: "Set up", status: { kind: "ready" }, blurb: "Tell the app which aircraft you fly: frame, controller and weight.", find: "vehicle drone frame mass board" },
  { path: "/connection", label: "Connection", icon: Cable, group: "Set up", status: { kind: "partial", note: "USB / radio link" }, blurb: "Link a Pixhawk over a USB cable or a telemetry radio.", find: "connect usb serial radio baud port link pixhawk" },
  { path: "/calibration", label: "Calibration", icon: Crosshair, group: "Set up", status: { kind: "partial", note: "Live on hardware" }, blurb: "Teach the sensors which way is level and north, and test the motors.", find: "accelerometer compass radio esc motor test level gyro modes" },
  { path: "/pid", label: "PID Tuning", icon: SlidersVertical, group: "Set up", status: { kind: "partial", note: "Live gains" }, blurb: "Stop wobble and sluggishness, with an advisor that says what to change.", find: "gains wobble oscillation rate tune" },
  { path: "/params", label: "Parameters", icon: ListTree, group: "Set up", status: { kind: "partial", note: "Read / write" }, blurb: "Every setting on the flight controller, searchable and editable.", find: "settings config param file advanced" },

  // Fly — check, rehearse and fly.
  { path: "/preflight", label: "Preflight Check", icon: ShieldCheck, group: "Fly", status: { kind: "partial", note: "Live health" }, blurb: "One go or no-go verdict before you arm.", find: "safety arm checklist gps battery ekf ready" },
  { path: "/flight-data", label: "Flight Data", icon: Plane, group: "Fly", status: { kind: "partial", note: "Live PFD" }, blurb: "Live instruments: attitude, heading, speed and height.", find: "hud instruments horizon pfd altitude live" },
  { path: "/keyboard-flight", label: "Keyboard Flight", icon: Keyboard, group: "Fly", status: { kind: "partial", note: "Live guided control" }, blurb: "Fly a short test hop from the keyboard, with no radio transmitter.", find: "takeoff land guided wasd control hop" },
  { path: "/simulator", label: "Flight Simulator", icon: Gamepad2, group: "Fly", status: { kind: "ready" }, blurb: "A virtual aircraft with real physics that every page can talk to. No hardware needed.", find: "sim practice virtual sitl physics failure wind motor rehearse test" },
  { path: "/missions", label: "Mission Planning", icon: Route, group: "Fly", status: { kind: "partial", note: "Waypoints + prediction" }, blurb: "Plan a route, then predict the flight: wind, battery and failures included.", find: "waypoints route auto predict failsafe plan upload" },

  // Review — diagnose and look back.
  { path: "/doctor", label: "Drone Doctor", icon: Stethoscope, group: "Review", status: { kind: "partial", note: "Live diagnosis" }, blurb: "A health scan that says what is wrong and how to fix it.", find: "diagnose fault problem vibration health fix ai" },
  { path: "/telemetry", label: "Telemetry", icon: Activity, group: "Review", status: { kind: "partial", note: "Live link data" }, blurb: "What is arriving over the link: message rates, events and raw data.", find: "mavlink messages rates events raw link diagnostics" },
  { path: "/logs", label: "Flight Logs", icon: ScrollText, group: "Review", status: { kind: "planned", phase: 7 }, blurb: "Open a log after landing and see what the aircraft experienced.", find: "bin ulg log analysis replay" },

  // System
  { path: "/about", label: "About", icon: Info, group: "System", status: { kind: "ready" }, blurb: "What AERONEX is, how to use it, and who made it.", find: "help info credits" },
  { path: "/settings", label: "Settings", icon: Settings, group: "System", status: { kind: "ready" }, blurb: "Display, motion, units and graphics quality.", find: "preferences units graphics motion api key" },
];

export const routeFor = (path: string) => ROUTES.find((r) => r.path === path) ?? ROUTES[0];
