import { ChevronDown, CircleAlert, Info, Plug, Radio, RotateCcw, ShieldCheck, Unplug, Usb } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AttitudeIndicator } from "../../components/ui/AttitudeIndicator";
import { useNow } from "../../hooks/useNow";
import { browserName, describeUsbDevice, hasWebSerial, isSecureContextOk } from "../../services/capabilities";
import { linkManager } from "../../services/link/linkManager";
import { BAUD_RATES, isPortOpen, useLink, type LinkMethod, type Stamped } from "../../state/linkStore";
import { confirmAction } from "../../state/notifyStore";
import { useSettings } from "../../state/settingsStore";
import { ago, altitude, clockTime, duration, GPS_FIX, RAD, speed } from "../../utils/format";
import { LINK_STATUS, TELEMETRY_STALE_MS } from "./linkStatus";

function Unsupported() {
  const secure = isSecureContextOk();
  return (
    <section className="panel">
      <div className="empty">
        <Usb />
        <h3>{secure ? `${browserName()} can't talk to serial devices` : "Serial access needs a secure page"}</h3>
        <p>
          {secure
            ? "Connecting a flight controller from the browser uses the Web Serial API, which is available in Chrome, Edge and Opera on desktop. Firefox and Safari don't support it."
            : "Web Serial only works on https:// pages or http://localhost. Open the app from localhost (npm run dev) or a secure URL."}
        </p>
        <p>The simulator, aircraft profiles and settings work in any modern browser.</p>
      </div>
    </section>
  );
}

function MethodPicker({ disabled }: { disabled: boolean }) {
  const method = useLink((s) => s.method);
  const setMethod = useLink((s) => s.setMethod);
  const opts: { id: LinkMethod; title: string; sub: string; icon: typeof Usb }[] = [
    { id: "usb", title: "USB cable", sub: "Flight controller plugged straight into this computer.", icon: Usb },
    { id: "radio", title: "Telemetry radio", sub: "Ground radio on USB, air radio on the drone's TELEM port.", icon: Radio },
  ];
  return (
    <div className="method-cards" role="group" aria-label="Connection method">
      {opts.map((o) => (
        <button key={o.id} className="method" aria-pressed={method === o.id} onClick={() => setMethod(o.id)} disabled={disabled}>
          <span className="m-icon">
            <o.icon size={18} />
          </span>
          <span>
            <strong>{o.title}</strong>
            <span>{o.sub}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function GrantedPorts({ disabled }: { disabled: boolean }) {
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const status = useLink((s) => s.status);
  const refresh = useCallback(() => void linkManager.grantedPorts().then(setPorts), []);
  useEffect(() => {
    refresh();
    const s = navigator.serial;
    s?.addEventListener("connect", refresh);
    s?.addEventListener("disconnect", refresh);
    return () => {
      s?.removeEventListener("connect", refresh);
      s?.removeEventListener("disconnect", refresh);
    };
  }, [refresh, status]);
  return (
    <div className="field">
      <span>Ports this site may use</span>
      {ports.length === 0 ? (
        <small>None yet. Press Connect and pick your device in the browser&rsquo;s list; it will be remembered here.</small>
      ) : (
        <div className="port-list">
          {ports.map((p, i) => (
            <div className="port-row" key={i}>
              <span>{describeUsbDevice(p.getInfo())}</span>
              <span style={{ display: "flex", gap: 6 }}>
                <button className="btn" style={{ height: 30 }} disabled={disabled} onClick={() => void linkManager.connect(p)}>
                  Connect
                </button>
                {p.forget && (
                  <button
                    className="btn btn-ghost"
                    style={{ height: 30 }}
                    disabled={disabled}
                    onClick={async () => {
                      await p.forget!();
                      refresh();
                    }}
                    title="Remove this site's permission for the port"
                  >
                    Forget
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectDial() {
  const status = useLink((s) => s.status);
  const connectedAt = useLink((s) => s.connectedAt);
  const openedAt = useLink((s) => s.openedAt);
  const last = useLink((s) => s.lastHeartbeatAt);
  const now = useNow(500);
  const open = isPortOpen(status);
  const busy = status === "selecting" || status === "opening" || status === "listening";
  const state = status === "connected" ? "connected" : busy ? "busy" : status === "stale" || status === "no-heartbeat" ? "warn" : "idle";
  const view = LINK_STATUS[status];

  const onClick = async () => {
    if (open) {
      const armed = useLink.getState().vehicle?.armed;
      if (armed) {
        const ok = await confirmAction({
          title: "Disconnect while armed?",
          body: "The vehicle reports it is armed. Disconnecting only closes this app's serial port; the aircraft keeps flying under its own control and failsafes.",
          confirmLabel: "Disconnect",
          tone: "danger",
        });
        if (!ok) return;
      }
      await linkManager.disconnect();
    } else {
      await linkManager.connect();
    }
  };

  return (
    <div className="connect-dial">
      <button className="connect-btn" data-state={state} onClick={onClick} disabled={status === "selecting" || status === "opening"}>
        <svg className="ring" viewBox="0 0 216 216" aria-hidden>
          <circle cx="108" cy="108" r="104" fill="none" stroke="var(--line)" strokeWidth="1" />
          <circle
            cx="108"
            cy="108"
            r="104"
            fill="none"
            opacity={state === "idle" ? 0 : 1}
            stroke={state === "connected" ? "var(--ok)" : state === "warn" ? "var(--warn)" : "var(--accent)"}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={state === "busy" ? "90 564" : state === "idle" ? "0 654" : "654 0"}
            style={{ transition: "stroke-dasharray 500ms var(--ease-out)" }}
          />
        </svg>
        <span className="cb-inner on-navy">
          {open ? <Unplug /> : <Plug />}
          <span className="cb-label">{open ? "DISCONNECT" : "CONNECT"}</span>
          <span className="cb-sub">{busy ? view.label : open ? "Close the serial port" : "Choose a serial port"}</span>
        </span>
      </button>
      <div style={{ textAlign: "center", display: "grid", gap: 6 }}>
        <span className={`pill ${view.tone}${view.live ? " live" : ""}`} style={{ justifySelf: "center" }}>
          {view.label}
        </span>
        {connectedAt && open ? (
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
            Connected <span className="num">{duration(now - connectedAt)}</span>, last heartbeat {ago(last, now)}
          </span>
        ) : openedAt && open ? (
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
            Port open <span className="num">{duration(now - openedAt)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ErrorPanel() {
  const error = useLink((s) => s.error);
  const status = useLink((s) => s.status);
  if (!error || (status !== "error" && status !== "lost")) return null;
  return (
    <div className="callout danger" role="alert">
      <CircleAlert />
      <div>
        <strong>{error.title}.</strong> {error.detail}
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {error.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NoHeartbeatHelp() {
  const status = useLink((s) => s.status);
  const stats = useLink((s) => s.stats);
  const method = useLink((s) => s.method);
  if (status !== "no-heartbeat") return null;
  const garbage = stats.bytes > 0 && stats.framesOk === 0;
  return (
    <div className="callout warn">
      <CircleAlert />
      <div>
        <strong>No autopilot heartbeat yet.</strong>{" "}
        {stats.bytes === 0
          ? "No data is arriving at all."
          : garbage
            ? `${stats.bytes.toLocaleString()} bytes arrived but none were valid MAVLink, which almost always means the baud rate doesn't match.`
            : `${stats.framesOk} valid frames arrived, but none came from a flight controller.`}{" "}
        {method === "usb"
          ? "Over USB, try 115200. Some boards take a few seconds to boot; the app keeps listening."
          : "Radios usually run at 57600. Check that both radios show a solid link light."}{" "}
        Disconnect, change the baud rate, and connect again.
      </div>
    </div>
  );
}

function Value<T>({ s, now, render, unit }: { s: Stamped<T> | undefined; now: number; render: (v: T) => string | null; unit?: string }) {
  if (!s) return <dd className="na">Not received</dd>;
  const text = render(s.value);
  if (text == null) return <dd className="na">Not reported</dd>;
  const stale = now - s.at > TELEMETRY_STALE_MS;
  return (
    <dd style={{ opacity: stale ? 0.5 : 1 }} title={stale ? `Stale: last update ${ago(s.at, now)}` : undefined}>
      {text}
      {unit && <small>{unit}</small>}
      {stale && <small style={{ color: "var(--warn)" }}> stale</small>}
    </dd>
  );
}

function VehiclePanels() {
  const v = useLink((s) => s.vehicle);
  const tel = useLink((s) => s.telemetry);
  const status = useLink((s) => s.status);
  const units = useSettings((s) => s.units);
  const now = useNow(500);
  if (!v) return null;
  const att = tel.attitude;
  const attStale = !att || now - att.at > TELEMETRY_STALE_MS;
  const pos = tel.position;
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h3>Discovered vehicle</h3>
          <span className={`pill ${status === "connected" ? "ok" : "warn"}`}>{status === "connected" ? "Heartbeat OK" : LINK_STATUS[status].label}</span>
        </div>
        <dl className="readouts" style={{ margin: 0, borderRadius: 0 }}>
          <div className="readout">
            <dt>Vehicle type</dt>
            <dd style={{ fontSize: "var(--t-md)" }}>{v.typeLabel}</dd>
          </div>
          <div className="readout">
            <dt>Firmware family</dt>
            <dd style={{ fontSize: "var(--t-md)" }}>{v.firmwareLabel}</dd>
          </div>
          <div className="readout">
            <dt>Flight mode</dt>
            {v.mode ? <dd style={{ fontSize: "var(--t-md)" }}>{v.mode}</dd> : <dd className="na">Not reported</dd>}
          </div>
          <div className="readout">
            <dt>Arming</dt>
            <dd style={{ fontSize: "var(--t-md)", color: v.armed ? "var(--warn)" : undefined }}>{v.armed ? "Armed" : "Disarmed"}</dd>
          </div>
          <div className="readout">
            <dt>System state</dt>
            <dd style={{ fontSize: "var(--t-md)" }}>{v.systemStatus}</dd>
          </div>
          <div className="readout">
            <dt>System / component</dt>
            <dd>
              {v.sysid} / {v.compid}
            </dd>
          </div>
          <div className="readout">
            <dt>Protocol</dt>
            <dd style={{ fontSize: "var(--t-md)" }}>MAVLink {v.protocol}</dd>
          </div>
          <div className="readout">
            <dt>Board</dt>
            <dd className="na" title="Board identity needs an AUTOPILOT_VERSION request, which the app doesn't send yet.">
              Not requested yet
            </dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>Live telemetry</h3>
          <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
            Shown only when the vehicle sends it
          </span>
        </div>
        <div className="panel-body attitude-mini">
          {att ? (
            <AttitudeIndicator roll={att.value.roll * RAD} pitch={att.value.pitch * RAD} stale={attStale} />
          ) : (
            <div className="empty" style={{ padding: 0, width: 132, height: 132, alignContent: "center" }}>
              <p style={{ fontSize: "var(--t-xs)" }}>No attitude received</p>
            </div>
          )}
          <dl className="readouts" style={{ margin: 0 }}>
            <div className="readout">
              <dt>Roll / pitch</dt>
              <Value s={att} now={now} render={(a) => `${(a.roll * RAD).toFixed(1)}° / ${(a.pitch * RAD).toFixed(1)}°`} />
            </div>
            <div className="readout">
              <dt>Heading</dt>
              <Value s={pos} now={now} render={(p) => (p.heading == null ? null : `${p.heading.toFixed(0)}°`)} />
            </div>
            <div className="readout">
              <dt>Altitude above home</dt>
              <Value
                s={pos}
                now={now}
                render={(p) => {
                  const a = altitude(p.relAlt, units);
                  return `${a.v} ${a.u}`;
                }}
              />
            </div>
            <div className="readout">
              <dt>GPS</dt>
              <Value s={tel.gps} now={now} render={(g) => `${GPS_FIX[g.fixType] ?? "Unknown"}${g.satellites != null ? `, ${g.satellites} sats` : ""}`} />
            </div>
            <div className="readout">
              <dt>Battery</dt>
              <Value s={tel.battery} now={now} render={(b) => (b.voltage == null ? null : `${b.voltage.toFixed(2)} V${b.remaining != null ? `, ${b.remaining}%` : ""}`)} />
            </div>
            <div className="readout">
              <dt>Ground speed</dt>
              <Value
                s={tel.hud}
                now={now}
                render={(h) => {
                  const sp = speed(h.groundspeed, units);
                  return `${sp.v} ${sp.u}`;
                }}
              />
            </div>
          </dl>
        </div>
        <div style={{ padding: "0 var(--s5) var(--s5)" }}>
          <div className="callout info">
            <Info />
            <span>
              On connect, the app asks the vehicle for the standard data streams, so attitude, GPS, battery and RC appear within a second or two (ArduPilot
              sends little beyond the heartbeat until asked). If a value stays blank, the vehicle isn&rsquo;t sending that message yet &mdash; for example, GPS
              before it has a fix.
            </span>
          </div>
        </div>
      </section>

      {tel.radio && (
        <section className="panel">
          <div className="panel-head">
            <h3>Telemetry radio</h3>
            <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
              Reported by the radio, {ago(tel.radio.at, now)}
            </span>
          </div>
          <dl className="readouts" style={{ margin: 0, borderRadius: 0 }}>
            {(
              [
                ["Local RSSI", tel.radio.value.rssi],
                ["Remote RSSI", tel.radio.value.remrssi],
                ["Local noise", tel.radio.value.noise],
                ["Remote noise", tel.radio.value.remnoise],
                ["Receive errors", tel.radio.value.rxerrors],
                ["Corrected packets", tel.radio.value.fixed],
              ] as const
            ).map(([k, val]) => (
              <div className="readout" key={k}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
}

function Diagnostics() {
  const stats = useLink((s) => s.stats);
  const events = useLink((s) => s.events);
  return (
    <section className="panel">
      <details className="diag">
        <summary>
          Link diagnostics <ChevronDown size={18} color="var(--muted)" />
        </summary>
        <dl className="readouts" style={{ margin: 0, borderRadius: 0, borderTop: "1px solid var(--line-soft)" }}>
          {(
            [
              ["Bytes received", stats.bytes.toLocaleString()],
              ["Valid frames", stats.framesOk.toLocaleString()],
              ["CRC failures", stats.crcErrors.toLocaleString()],
              ["Unknown message ids", stats.unknownMsg.toLocaleString()],
              ["MAVLink 1 / 2 frames", `${stats.v1} / ${stats.v2}`],
              ["Autopilot heartbeats", stats.heartbeats.toLocaleString()],
              ["Other systems seen", stats.otherSystems.length ? stats.otherSystems.join(", ") : "None"],
            ] as const
          ).map(([k, v]) => (
            <div className="readout" key={k}>
              <dt>{k}</dt>
              <dd style={{ fontSize: "var(--t-md)" }}>{v}</dd>
            </div>
          ))}
        </dl>
        <div style={{ padding: "var(--s3) var(--s5)", borderTop: "1px solid var(--line-soft)", display: "flex", justifyContent: "space-between" }}>
          <strong style={{ fontSize: "var(--t-sm)" }}>Connection events</strong>
          <Link to="/telemetry" style={{ fontSize: "var(--t-sm)" }}>
            Full diagnostics
          </Link>
        </div>
        {events.length === 0 ? (
          <p className="muted" style={{ padding: "0 var(--s5) var(--s4)", fontSize: "var(--t-sm)" }}>
            Nothing yet.
          </p>
        ) : (
          <ul className="event-log">
            {events.slice(0, 40).map((e) => (
              <li key={e.id} className={e.level}>
                <span className="num">{clockTime(e.at)}</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function RadioPrereqs() {
  const method = useLink((s) => s.method);
  if (method !== "radio") return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Before you connect by radio</h3>
      </div>
      <ul className="plan-list" style={{ padding: "0 var(--s5)" }}>
        {[
          ["Two paired radios", "The ground radio is plugged into this computer; the air radio is wired to TELEM1 (or the port you configured) on the flight controller."],
          ["Matching radio settings", "Both radios share the same air speed, net ID and frequency band. A solid link light on both usually means they're paired."],
          ["The vehicle sends MAVLink on that port", "ArduPilot: SERIALn_PROTOCOL = 2 and SERIALn_BAUD = 57. PX4: MAV_0_CONFIG points at that TELEM port, with its baud parameter (for example SER_TEL1_BAUD) at 57600."],
          ["Baud rate here matches the ground radio", "This is the USB-side serial speed of the ground radio, usually 57600."],
        ].map(([t, d]) => (
          <li key={t}>
            <ShieldCheck />
            <div>
              <strong>{t}</strong>
              <p>{d}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConnectionPage() {
  const status = useLink((s) => s.status);
  const baud = useLink((s) => s.baud);
  const setBaud = useLink((s) => s.setBaud);
  const method = useLink((s) => s.method);
  const supported = hasWebSerial() && isSecureContextOk();
  const locked = isPortOpen(status) || status === "selecting" || status === "opening";

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Connection</h1>
          <p>Connect a Pixhawk 2.4.8, Pixhawk 6C Mini or another MAVLink flight controller over USB or a telemetry radio.</p>
        </div>
        {(status === "error" || status === "lost") && (
          <div className="actions">
            <button className="btn" onClick={() => void linkManager.connect()}>
              <RotateCcw /> Try again
            </button>
          </div>
        )}
      </header>

      {!supported ? (
        <Unsupported />
      ) : (
        <div className="split">
          <div className="stack">
            <section className="panel conn-panel">
              <div className="conn-hero">
                <div className="conn-form">
                  <MethodPicker disabled={locked} />
                  <div className="row">
                    <label className="field">
                      <span>Baud rate</span>
                      <select className="select" value={baud} onChange={(e) => setBaud(Number(e.target.value))} disabled={locked}>
                        {BAUD_RATES.map((b) => (
                          <option key={b} value={b}>
                            {b.toLocaleString()}
                            {method === "usb" && b === 115200 ? " (usual for USB)" : ""}
                            {method === "radio" && b === 57600 ? " (usual for radios)" : ""}
                          </option>
                        ))}
                      </select>
                      <small>{method === "usb" ? "Native USB ignores this on most boards; 115200 is safe." : "Must match the ground radio's serial speed."}</small>
                    </label>
                    <div className="field">
                      <span>Link mode</span>
                      <div className="callout" style={{ padding: "8px 12px", alignItems: "center" }}>
                        <ShieldCheck size={16} />
                        <span>Reads passively. Writes only when you run a calibration or command.</span>
                      </div>
                    </div>
                  </div>
                  <GrantedPorts disabled={locked} />
                </div>
                <ConnectDial />
              </div>
            </section>
            <ErrorPanel />
            <NoHeartbeatHelp />
            <VehiclePanels />
            <Diagnostics />
          </div>
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h3>What this link does</h3>
              </div>
              <div className="panel-body" style={{ display: "grid", gap: "var(--s3)", fontSize: "var(--t-sm)", color: "var(--ink-2)" }}>
                <p>
                  The app opens the serial port, validates every MAVLink frame against its checksum, and waits for a heartbeat from a flight controller. It then
                  shows the vehicle type, firmware family, mode and arming state it reports.
                </p>
                <p>
                  On its own the app sends only what keeps the link working: a once-a-second ground-station heartbeat (the aircraft&rsquo;s link-loss
                  failsafe depends on it) and requests for telemetry and settings. Anything that changes the aircraft &mdash; a parameter, a calibration, a
                  motor test, arming, a mode, a mission &mdash; is sent only when you run it, is tracked for the vehicle&rsquo;s acknowledgement, and goes only
                  to ArduCopter. Motor actions stay behind a disarmed, props-off gate.
                </p>
                <p>If heartbeats stop for 3 seconds, every value on screen is marked stale.</p>
              </div>
            </section>
            <RadioPrereqs />
          </div>
        </div>
      )}
    </div>
  );
}
