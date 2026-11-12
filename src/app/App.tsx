import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AboutPage } from "../features/about/AboutPage";
import { BrandLockup } from "../components/shell/BrandMark";
import { HelpPanel } from "../components/shell/HelpPanel";
import { SearchPalette } from "../components/shell/SearchPalette";
import { ConfirmDialog, Toasts } from "../components/shell/Overlays";
import { Sidebar } from "../components/shell/Sidebar";
import { StatusBar } from "../components/shell/StatusBar";
import { CalibrationPage } from "../features/calibration/CalibrationPage";
import { ConnectionPage } from "../features/connection/ConnectionPage";
import { DigitalTwinPage } from "../features/digital-twin/DigitalTwinPage";
import { DoctorPage } from "../features/doctor/DoctorPage";
import { FlightDataPage } from "../features/flightdata/FlightDataPage";
import { FrameStudioPage } from "../features/frame-studio/FrameStudioPage";
import { LogsPage } from "../features/logs/LogsPage";
import { MissionPlanningPage } from "../features/mission-planning/MissionPlanningPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { FullParamsPage } from "../features/params/FullParamsPage";
import { KeyboardFlightPage } from "../features/keyboard-flight/KeyboardFlightPage";
import { PidTuningPage } from "../features/pid/PidTuningPage";
import { PreflightPage } from "../features/preflight/PreflightPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { SimulatorPage } from "../features/simulator/SimulatorPage";
import { TelemetryPage } from "../features/telemetry/TelemetryPage";
import { VehicleConfigPage } from "../features/vehicle-config/VehicleConfigPage";
import { prefersReducedMotion, useSettings } from "../state/settingsStore";
import { useLinkNotifications } from "./useLinkNotifications";
import { useLink } from "../state/linkStore";
import { commandLink } from "../services/link/commandLink";
import { routeFor } from "./routes";
import { useUi } from "../state/uiStore";

/* Stream a 1 Hz GCS heartbeat whenever a vehicle is connected, so ArduPilot's
   GCS failsafe is armed. It stops when the tab closes or the link drops, which
   is what triggers the vehicle to land on its own. */
function useGcsHeartbeat() {
  const status = useLink((s) => s.status);
  useEffect(() => {
    if (status === "connected") {
      commandLink.startHeartbeat();
      return () => commandLink.stopHeartbeat();
    }
  }, [status]);
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        className="page"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/connection" element={<ConnectionPage />} />
          <Route path="/digital-twin" element={<DigitalTwinPage />} />
          <Route path="/frame-studio" element={<FrameStudioPage />} />
          <Route path="/calibration" element={<CalibrationPage />} />
          <Route path="/doctor" element={<DoctorPage />} />
          <Route path="/vehicle" element={<VehicleConfigPage />} />
          <Route path="/pid" element={<PidTuningPage />} />
          <Route path="/params" element={<FullParamsPage />} />
          <Route path="/preflight" element={<PreflightPage />} />
          <Route path="/flight-data" element={<FlightDataPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
          <Route path="/keyboard-flight" element={<KeyboardFlightPage />} />
          <Route path="/missions" element={<MissionPlanningPage />} />
          <Route path="/telemetry" element={<TelemetryPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<OverviewPage />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

/* The tab says which page it is on, so several open tabs can be told apart. */
function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const r = routeFor(pathname);
    document.title = r.path === "/" ? "AERONEX Ground Station" : `${r.label} – AERONEX`;
  }, [pathname]);
}

/*
  App-wide keys: Ctrl or ⌘ K to search, ? for the guide. The ? is ignored
  while typing in a field, where it is just a question mark.
*/
function useGlobalKeys() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUi.getState().toggle("search");
      } else if (e.key === "?" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        useUi.getState().toggle("help");
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
}

function Frame() {
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const help = useUi((s) => s.overlay === "help");
  const nav = useNavigate();
  useLinkNotifications();
  useGcsHeartbeat();
  usePageTitle();
  useGlobalKeys();
  return (
    <div className="app" data-collapsed={collapsed} data-help={help}>
      <a className="skip-link" href="#main">
        Skip to the page
      </a>
      <button className="brand" onClick={() => nav("/")} title="AERONEX Ground Station — Overview">
        <BrandLockup />
      </button>
      <StatusBar />
      <Sidebar />
      <main className="main" id="main">
        <AnimatedRoutes />
      </main>
      <HelpPanel />
      <SearchPalette />
      <Toasts />
      <ConfirmDialog />
    </div>
  );
}

export default function App() {
  const motionPref = useSettings((s) => s.motion);
  const reduced = prefersReducedMotion(motionPref);
  useEffect(() => {
    document.documentElement.dataset.motion = reduced ? "reduced" : "full";
  }, [reduced]);
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "never"}>
      <HashRouter>
        <Frame />
      </HashRouter>
    </MotionConfig>
  );
}
