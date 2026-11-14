import { Cable, Compass, Fan, Gauge, Radio, SlidersHorizontal, Zap } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLink } from "../../state/linkStore";
import { vehicleBlock } from "../../services/link/commandLink";
import { AccelSection } from "./AccelSection";
import { CompassSection } from "./CompassSection";
import { RadioSection } from "./RadioSection";
import { FlightModesSection } from "./FlightModesSection";
import { EscSection } from "./EscSection";
import { MotorTestSection } from "./MotorTestSection";

type Tab = "accel" | "compass" | "radio" | "modes" | "esc" | "motors";

const TABS: { id: Tab; label: string; icon: typeof Gauge }[] = [
  { id: "accel", label: "Accel & Level", icon: Gauge },
  { id: "compass", label: "Compass", icon: Compass },
  { id: "radio", label: "Radio", icon: Radio },
  { id: "modes", label: "Flight Modes", icon: SlidersHorizontal },
  { id: "esc", label: "ESC", icon: Zap },
  { id: "motors", label: "Motor Test", icon: Fan },
];

export function CalibrationPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const connected = !!vehicle && (status === "connected" || status === "stale");
  // Every flow on this page is ArduCopter's: other firmware is shown, not changed.
  const notCopter = vehicle ? vehicleBlock() : null;
  const canSend = !!vehicle && status === "connected" && !notCopter;
  const [tab, setTab] = useState<Tab>("accel");

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Calibration</h1>
          <p>Level, accelerometer, compass, radio, flight modes and ESCs — the Mission Planner setup sequence, run against your connected autopilot.</p>
        </div>
        <div className="actions">
          {connected ? (
            <span className={`pill ${canSend ? "ok" : "warn"} plain`}>
              {vehicle!.firmwareLabel} · sys {vehicle!.sysid}
              {vehicle!.armed ? " · ARMED" : ""}
            </span>
          ) : (
            <Link className="btn btn-primary" to="/connection">
              <Cable /> Connect aircraft
            </Link>
          )}
        </div>
      </header>

      {!connected && (
        <div className="callout" style={{ marginBottom: "var(--s4)" }}>
          <span>Calibration needs a connected flight controller — nothing here runs as a demo. Connect over USB or a telemetry radio, then every screen works against your vehicle's own values.</span>
        </div>
      )}
      {notCopter && (
        <div className="callout warn" role="alert" style={{ marginBottom: "var(--s4)" }}>
          <span><strong>{notCopter.title}.</strong> {notCopter.body}</span>
        </div>
      )}

      <div className="cal-tabs segmented">
        {TABS.map((t) => (
          <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            <t.icon /> {t.label}
          </button>
        ))}
      </div>

      <div className="cal-pane">
        {tab === "accel" && <AccelSection canSend={canSend} />}
        {tab === "compass" && <CompassSection canSend={canSend} />}
        {tab === "radio" && <RadioSection canSend={canSend} />}
        {tab === "modes" && <FlightModesSection canSend={canSend} />}
        {tab === "esc" && <EscSection canSend={canSend} />}
        {tab === "motors" && <MotorTestSection canSend={canSend} />}
      </div>

      <p className="cal-foot muted">
        Completing calibration doesn't make an aircraft safe to fly — the vehicle's own pre-arm checks remain the authority. The link writes only the commands and parameters you trigger here.
      </p>
    </div>
  );
}
