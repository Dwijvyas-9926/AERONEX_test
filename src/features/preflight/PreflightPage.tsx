import { Activity, BatteryMedium, Cable, CircleCheck, Compass, Radio, Satellite, ShieldAlert, ShieldCheck, Waves } from "lucide-react";
import { Link } from "react-router-dom";
import { useNow } from "../../hooks/useNow";
import { useLink } from "../../state/linkStore";
import { batteryHealth, GPS_FIX_LABEL, gpsHealth, type Health, SENSOR_BITS, sensorHealth, varianceHealth, vibeHealth, worst } from "./health";

function Dot({ h }: { h: Health }) {
  return <span className={`pf-dot ${h}`} aria-hidden />;
}

function Bar({ value, max, h }: { value: number; max: number; h: Health }) {
  return (
    <div className="pf-bar">
      <div className={`pf-bar-fill ${h}`} style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

export function PreflightPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const tel = useLink((s) => s.telemetry);
  const events = useLink((s) => s.events);
  const connected = !!vehicle && (status === "connected" || status === "stale");

  if (!connected) {
    return (
      <div className="page-pad">
        <header className="page-head">
          <div>
            <h1>Preflight Check</h1>
            <p>A go / no-go readout of everything the autopilot reports about its own health, before you arm.</p>
          </div>
          <Link className="btn btn-primary" to="/connection">
            <Cable /> Connect a vehicle
          </Link>
        </header>
        <div className="callout"><span>Connect a flight controller to see live pre-arm, EKF, GPS, vibration and battery health. Nothing here is simulated.</span></div>
      </div>
    );
  }

  const armed = vehicle!.armed;
  const now = useNow(500);
  const isFresh = (at?: number) => at != null && now - at < 3000;
  const sensors = tel.sensors?.value;
  const ekf = tel.ekf?.value;
  const vibe = tel.vibration?.value;
  const gps = tel.gps?.value;
  const batt = tel.battery?.value;
  const rc = tel.rc?.value;

  const sensorsFresh = isFresh(tel.sensors?.at);
  // Fold staleness into each check: present + fresh → real health; present but
  // stale (telemetry stopped) → warn; absent → unknown. Prevents a frozen reading
  // from being presented as a current, healthy one.
  const stale = (h: Health, present: boolean, at?: number): Health => (!present ? "unknown" : isFresh(at) ? h : "warn");

  const sensorChecks = SENSOR_BITS.map((s) => ({
    ...s,
    health: !sensors ? ("unknown" as Health) : !sensorsFresh ? ("warn" as Health) : sensorHealth(s.bit, sensors.present, sensors.health),
  }));
  const gpsPresent = sensors ? !!(sensors.present & (1 << 5)) : false;
  const ekfHealth = stale(ekf ? worst([ekf.velVar, ekf.posHoriz, ekf.posVert, ekf.compass].map(varianceHealth)) : ("unknown" as Health), !!ekf, tel.ekf?.at);
  const vibeHealthAll = stale(vibe ? worst([vibeHealth(vibe.x), vibeHealth(vibe.y), vibeHealth(vibe.z), vibe.clip0 + vibe.clip1 + vibe.clip2 > 0 ? "warn" : "ok"]) : ("unknown" as Health), !!vibe, tel.vibration?.at);
  const gpsH = stale(gps ? gpsHealth(gps.fixType) : ("unknown" as Health), !!gps, tel.gps?.at);
  const battH = stale(batt ? batteryHealth(batt.remaining, batt.voltage) : ("unknown" as Health), !!batt, tel.battery?.at);

  // Only channels that actually have data contribute to the verdict, so an
  // absent optional channel doesn't wedge it on "waiting".
  const graded = [
    ...sensorChecks.filter((s) => s.critical).map((s) => s.health),
    ekfHealth,
    ...(gpsPresent ? [gpsH] : []),
    vibeHealthAll,
    battH,
  ].filter((h) => h !== "unknown" && h !== "absent");
  const overall = graded.length ? worst(graded) : ("unknown" as Health);
  const telemetryStale = !!sensors && !sensorsFresh;

  const prearm = events.filter((e) => /prearm/i.test(e.text)).slice(0, 6);

  const verdict = armed
    ? { cls: "go", icon: ShieldCheck, title: "Armed", note: "The vehicle is armed." }
    : telemetryStale
      ? { cls: "caution", icon: ShieldAlert, title: "Telemetry stale", note: "Live health messages have stopped. Reconnect and let telemetry refresh before trusting this readout." }
      : graded.length === 0
        ? { cls: "wait", icon: Activity, title: "Waiting for data", note: "Waiting for the vehicle to stream its health messages." }
        : overall === "ok"
          ? { cls: "go", icon: ShieldCheck, title: "Ready to arm", note: "Live telemetry shows no blocking issues. The vehicle's own pre-arm checks remain the authority." }
          : overall === "warn"
            ? { cls: "caution", icon: ShieldAlert, title: "Caution", note: "Some values are marginal or stale. Review the flagged items below before flying." }
            : { cls: "nogo", icon: ShieldAlert, title: "Not ready", note: "One or more health checks are failing. Resolve them before arming." };

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Preflight Check</h1>
          <p>Live health the autopilot reports about itself — sensors, state estimate, GPS, vibration and battery — rolled into one go / no-go view.</p>
        </div>
        <span className={`pill ${status === "connected" ? "ok" : "warn"} plain`}>{vehicle!.firmwareLabel} · sys {vehicle!.sysid}</span>
      </header>

      <div className={`pf-verdict ${verdict.cls}`}>
        <verdict.icon />
        <div>
          <strong>{verdict.title}</strong>
          <span>{verdict.note}</span>
        </div>
      </div>

      <div className="pf-grid">
        {/* Sensors */}
        <section className="panel pf-tile">
          <div className="panel-head"><h3><CircleCheck size={16} /> Sensor health</h3></div>
          <div className="pf-sensors">
            {sensorChecks.map((s) => (
              <div key={s.label} className="pf-row">
                <Dot h={s.health} />
                <span>{s.label}</span>
                <span className="pf-state">{s.health === "absent" ? "not present" : s.health === "unknown" ? "—" : s.health === "ok" ? "healthy" : "unhealthy"}</span>
              </div>
            ))}
          </div>
        </section>

        {/* EKF */}
        <section className="panel pf-tile">
          <div className="panel-head"><h3><Compass size={16} /> EKF / state estimate</h3><Dot h={ekfHealth} /></div>
          <div className="pf-body">
            {ekf ? (
              <>
                <EkfRow label="Velocity" v={ekf.velVar} />
                <EkfRow label="Horiz. position" v={ekf.posHoriz} />
                <EkfRow label="Vert. position" v={ekf.posVert} />
                <EkfRow label="Compass" v={ekf.compass} />
                {!isFresh(tel.ekf?.at) && <p className="pf-stale">stale</p>}
              </>
            ) : (
              <p className="muted">No EKF_STATUS_REPORT yet.</p>
            )}
          </div>
        </section>

        {/* GPS */}
        <section className="panel pf-tile">
          <div className="panel-head"><h3><Satellite size={16} /> GPS</h3><Dot h={gpsH} /></div>
          <div className="pf-body">
            {gps ? (
              <dl className="pf-kv">
                <div><dt>Fix</dt><dd>{GPS_FIX_LABEL[gps.fixType] ?? gps.fixType}</dd></div>
                <div><dt>Satellites</dt><dd>{gps.satellites ?? "—"}</dd></div>
                <div><dt>HDOP</dt><dd>{gps.hdop != null ? gps.hdop.toFixed(2) : "—"}</dd></div>
              </dl>
            ) : (
              <p className="muted">No GPS data.</p>
            )}
          </div>
        </section>

        {/* Vibration */}
        <section className="panel pf-tile">
          <div className="panel-head"><h3><Waves size={16} /> Vibration</h3><Dot h={vibeHealthAll} /></div>
          <div className="pf-body">
            {vibe ? (
              <>
                <VibeRow label="X" v={vibe.x} />
                <VibeRow label="Y" v={vibe.y} />
                <VibeRow label="Z" v={vibe.z} />
                <div className="pf-clip">Clipping: {vibe.clip0 + vibe.clip1 + vibe.clip2} {vibe.clip0 + vibe.clip1 + vibe.clip2 > 0 ? "⚠" : "✓"}</div>
              </>
            ) : (
              <p className="muted">No VIBRATION data.</p>
            )}
          </div>
        </section>

        {/* Battery */}
        <section className="panel pf-tile">
          <div className="panel-head"><h3><BatteryMedium size={16} /> Battery</h3><Dot h={battH} /></div>
          <div className="pf-body">
            {batt ? (
              <dl className="pf-kv">
                <div><dt>Voltage</dt><dd>{batt.voltage != null ? `${batt.voltage.toFixed(2)} V` : "—"}</dd></div>
                <div><dt>Current</dt><dd>{batt.current != null ? `${batt.current.toFixed(1)} A` : "—"}</dd></div>
                <div><dt>Remaining</dt><dd>{batt.remaining != null ? `${batt.remaining}%` : "—"}</dd></div>
              </dl>
            ) : (
              <p className="muted">No battery telemetry.</p>
            )}
          </div>
        </section>

        {/* RC */}
        <section className="panel pf-tile">
          <div className="panel-head"><h3><Radio size={16} /> RC link</h3><Dot h={rc && rc.count > 0 ? "ok" : "unknown"} /></div>
          <div className="pf-body">
            {rc ? (
              <dl className="pf-kv">
                <div><dt>Channels</dt><dd>{rc.count}</dd></div>
                <div><dt>RSSI</dt><dd>{rc.rssi != null ? rc.rssi : "—"}</dd></div>
              </dl>
            ) : (
              <p className="muted">No RC channels reported.</p>
            )}
          </div>
        </section>
      </div>

      {/* Pre-arm messages */}
      <section className="panel" style={{ marginTop: "var(--s4)" }}>
        <div className="panel-head"><h3>{armed ? "Vehicle armed" : "Pre-arm messages"}</h3></div>
        <div className="panel-body cal-body">
          {prearm.length === 0 ? (
            <p className="muted">{armed ? "The vehicle is armed; pre-arm checks passed." : "No pre-arm messages received. If the vehicle refuses to arm, its reason will appear here."}</p>
          ) : (
            <ul className="pf-prearm">
              {prearm.map((e) => (
                <li key={e.id} className={e.level}>{e.text.replace(/^[^:]*:\s*/, "")}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="cal-foot muted">
        This mirrors the autopilot's reported health; it is not a substitute for the vehicle's own pre-arm checks, which decide whether it will arm.
      </p>
    </div>
  );
}

function EkfRow({ label, v }: { label: string; v: number }) {
  const h = varianceHealth(v);
  return (
    <div className="pf-meter">
      <span className="pf-meter-label">{label}</span>
      <Bar value={v} max={1} h={h} />
      <span className="pf-meter-val">{v.toFixed(2)}</span>
    </div>
  );
}

function VibeRow({ label, v }: { label: string; v: number }) {
  const h = vibeHealth(v);
  return (
    <div className="pf-meter">
      <span className="pf-meter-label">{label}</span>
      <Bar value={v} max={90} h={h} />
      <span className="pf-meter-val">{v.toFixed(0)}</span>
    </div>
  );
}
