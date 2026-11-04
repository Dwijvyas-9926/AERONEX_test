import { BatteryMedium, Bell, Check, ChevronDown, Plus, Satellite, Settings, ShieldAlert } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LINK_STATUS, TELEMETRY_STALE_MS } from "../../features/connection/linkStatus";
import { useDismiss, useNow } from "../../hooks/useNow";
import { isPortOpen, useLink } from "../../state/linkStore";
import { useNotify } from "../../state/notifyStore";
import { useActiveProfile, useProfiles } from "../../state/profileStore";
import { BOARD_LABELS } from "../../vehicle/types";
import { clockTime, GPS_FIX } from "../../utils/format";

function VehicleSwitch() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeId);
  const setActive = useProfiles((s) => s.setActive);
  const active = useActiveProfile();
  const nav = useNavigate();
  return (
    <div className="vehicle-switch" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <span style={{ display: "grid", textAlign: "left", lineHeight: 1.15 }}>
          <span className="vs-name">{active?.name ?? "No profile"}</span>
          <span className="vs-sub">{active ? BOARD_LABELS[active.board] : "Create a vehicle profile"}</span>
        </span>
        <ChevronDown size={14} color="var(--muted)" />
      </button>
      {open && (
        <div className="menu" role="menu">
          {profiles.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={p.id === activeId}
              className="menu-item"
              onClick={() => {
                setActive(p.id);
                close();
              }}
            >
              <span style={{ width: 16 }}>{p.id === activeId && <Check />}</span>
              <span style={{ flex: 1 }}>{p.name}</span>
              <span className="muted" style={{ fontSize: "var(--t-xs)" }}>
                {BOARD_LABELS[p.board]}
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              close();
              nav("/vehicle");
            }}
          >
            <Plus /> Manage vehicle profiles
          </button>
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);
  const history = useNotify((s) => s.history);
  const clear = useNotify((s) => s.clearHistory);
  const [seen, setSeen] = useState(0);
  const unread = history.length > 0 && history[0].at > seen;
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="icon-btn"
        aria-label="Notifications"
        onClick={() => {
          setOpen((o) => !o);
          setSeen(Date.now());
        }}
      >
        <Bell />
        {unread && <span className="dot" />}
      </button>
      {open && (
        <div className="menu right" style={{ width: 340, maxHeight: 420, overflowY: "auto" }}>
          {history.length === 0 ? (
            <p className="muted" style={{ padding: "10px 10px 12px", fontSize: "var(--t-sm)" }}>
              Nothing yet. Connection events, saves and warnings appear here.
            </p>
          ) : (
            <>
              {history.map((h) => (
                <div key={h.id} style={{ padding: "8px 10px", borderBottom: "1px solid var(--line-soft)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--t-sm)" }}>
                    <strong style={{ color: h.tone === "error" ? "var(--danger)" : h.tone === "warn" ? "var(--warn)" : "var(--ink)" }}>{h.title}</strong>
                    <span className="num muted">{clockTime(h.at)}</span>
                  </div>
                  {h.body && <p className="muted" style={{ fontSize: "var(--t-xs)", marginTop: 2 }}>{h.body}</p>}
                </div>
              ))}
              <button className="menu-item" onClick={clear} style={{ marginTop: 4 }}>
                Clear notifications
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function StatusBar() {
  const status = useLink((s) => s.status);
  const vehicle = useLink((s) => s.vehicle);
  const tel = useLink((s) => s.telemetry);
  const now = useNow(1000);
  const nav = useNavigate();
  const view = LINK_STATUS[status];
  const open = isPortOpen(status);
  const fresh = (at?: number) => !!at && now - at < TELEMETRY_STALE_MS;

  return (
    <header className="statusbar">
      <VehicleSwitch />
      <div className="sb-sep sb-hide-xs" />
      <div className="sb-group sb-hide-xs">
        {open && (
          <span className="pill accent plain" title="Operating mode">
            Physical aircraft
          </span>
        )}
        <button
          className={`pill ${view.tone}${view.live ? " live" : ""}`}
          style={{ border: 0, cursor: "pointer" }}
          onClick={() => nav("/connection")}
          title="Open Vehicle Connection"
        >
          {view.label}
        </button>
      </div>

      {vehicle && (
        <>
          <div className="sb-sep sb-hide-sm" />
          <div className="sb-group sb-hide-sm">
            <span className="sb-metric" title="Firmware reported in the heartbeat">
              {vehicle.firmwareLabel}
            </span>
            {vehicle.mode && (
              <span className="sb-metric" title="Flight mode">
                <span className="num">{vehicle.mode}</span>
              </span>
            )}
            <span className={`pill ${vehicle.armed ? "warn" : "plain"}`} title="Arming state from heartbeat">
              {vehicle.armed ? (
                <>
                  <ShieldAlert size={13} /> Armed
                </>
              ) : (
                "Disarmed"
              )}
            </span>
            {tel.gps && (
              <span className={`sb-metric${fresh(tel.gps.at) ? "" : " dim"}`} title="GPS">
                <Satellite />
                <span className="num">{tel.gps.value.satellites ?? "–"}</span>
                <span>{GPS_FIX[tel.gps.value.fixType] ?? "Unknown"}</span>
              </span>
            )}
            {tel.battery?.value.voltage != null && (
              <span className={`sb-metric${fresh(tel.battery.at) ? "" : " dim"}`} title="Battery">
                <BatteryMedium />
                <span className="num">{tel.battery.value.voltage.toFixed(1)} V</span>
                {tel.battery.value.remaining != null && <span className="num">{tel.battery.value.remaining}%</span>}
              </span>
            )}
          </div>
        </>
      )}

      <div className="sb-right">
        <Notifications />
        <button className="icon-btn" aria-label="Settings" onClick={() => nav("/settings")}>
          <Settings />
        </button>
      </div>
    </header>
  );
}
