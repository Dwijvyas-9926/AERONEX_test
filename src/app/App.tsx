import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { useEffect } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { AboutPage } from "../features/about/AboutPage";
import { BrandMark } from "../components/shell/BrandMark";
import { ConfirmDialog, Toasts } from "../components/shell/Overlays";
import { Sidebar } from "../components/shell/Sidebar";
import { StatusBar } from "../components/shell/StatusBar";
import { CalibrationPage } from "../features/calibration/CalibrationPage";
import { ConnectionPage } from "../features/connection/ConnectionPage";
import { DigitalTwinPage } from "../features/digital-twin/DigitalTwinPage";
import { FlightDataPage } from "../features/flightdata/FlightDataPage";
import { LogsPage } from "../features/logs/LogsPage";
import { MissionPlanningPage } from "../features/mission-planning/MissionPlanningPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { FullParamsPage } from "../features/params/FullParamsPage";
import { PidTuningPage } from "../features/pid/PidTuningPage";
import { PreflightPage } from "../features/preflight/PreflightPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { SimulatorPage } from "../features/simulator/SimulatorPage";
import { TelemetryPage } from "../features/telemetry/TelemetryPage";
import { VehicleConfigPage } from "../features/vehicle-config/VehicleConfigPage";
import { prefersReducedMotion, useSettings } from "../state/settingsStore";
import { useLinkNotifications } from "./useLinkNotifications";

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
          <Route path="/calibration" element={<CalibrationPage />} />
          <Route path="/vehicle" element={<VehicleConfigPage />} />
          <Route path="/pid" element={<PidTuningPage />} />
          <Route path="/params" element={<FullParamsPage />} />
          <Route path="/preflight" element={<PreflightPage />} />
          <Route path="/flight-data" element={<FlightDataPage />} />
          <Route path="/simulator" element={<SimulatorPage />} />
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

function Frame() {
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  useLinkNotifications();
  return (
    <div className="app" data-collapsed={collapsed}>
      <div className="brand">
        <BrandMark />
        <span className="brand-name">
          AERONEX <span>Ground Station</span>
        </span>
      </div>
      <StatusBar />
      <Sidebar />
      <main className="main" id="main">
        <AnimatedRoutes />
      </main>
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
