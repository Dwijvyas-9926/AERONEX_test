import { ConnectPrompt } from "../../components/ui/ConnectPrompt";
import { Activity, BatteryMedium, Radar, CircleCheck, Compass, Radio, Satellite, ShieldAlert, ShieldCheck, Waves } from "lucide-react";
import { useEffect } from "react";
import { useNow } from "../../hooks/useNow";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { commandLink } from "../../services/link/commandLink";
import { GPS_FIX_LABEL, type Health, preflightVerdict, varianceHealth, vibeHealth } from "./health";

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
  // Every hook must run on every render. Reading the clock after the
  // disconnected early return below would change the hook count the moment a
  // vehicle connects, which React treats as a fatal error.
  const now = useNow(500);
  const connected = !!vehicle && (status === "connected" || status === "stale");
  const battLow = useParams((p) => p.values.BATT_LOW_VOLT);
  const battCrit = useParams((p) => p.values.BATT_CRT_VOLT);
  // The battery is graded against the aircraft's own limits, so read them.
  const sysid = vehicle?.sysid;
  useEffect(() => {
    if (sysid != null && commandLink.canSend) void commandLink.requestParams(["BATT_LOW_VOLT", "BATT_CRT_VOLT"]);
  }, [sysid]);

  if (!connected) {
    return (
      <div className="page-pad">
        <header className="page-head">
          <div>
            <h1>Preflight Check</h1>
            <p>A go / no-go readout of everything the autopilot reports about its own health, before you arm.</p>
          </div>
        </header>
        <ConnectPrompt
          title="Connect an aircraft for a go / no-go"
          items={[
            { icon: ShieldAlert, title: "Pre-arm checks", detail: "The autopilot's own reasons for refusing to arm, as it gives them." },
            { icon: Radar, title: "Sensors and estimator", detail: "Which sensors are present and healthy, and whether the estimate has settled." },
            { icon: Satellite, title: "GPS", detail: "Fix type, satellites in use and horizontal accuracy." },
            { icon: BatteryMedium, title: "Battery and vibration", detail: "Voltage against the pack's limits, and vibration on the bench." },
          ]}
        >
          One verdict before you arm, built from what the autopilot says about its own health. It is read live from
          the aircraft, so there is nothing to check until one is linked.
        </ConnectPrompt>
      </div>
    );
  }

  const armed = vehicle!.armed;
  const isFresh = (at?: number) => at != null && now - at < 3000;
  const ekf = tel.ekf?.value;
  const vibe = tel.vibration?.value;
  const gps = tel.gps?.value;
  const batt = tel.battery?.value;
  const rc = tel.rc?.value;

  const verdict = preflightVerdict({
    now,
    armed,
    sensors: tel.sensors,
    attitude: tel.attitude,
    ekf: tel.ekf,
    gps: tel.gps,
    battery: tel.battery,
    vibration: tel.vibration,
    battLimits: { low: battLow, crit: battCrit },
    events,
  });
  const { sensors: sensorChecks, ekf: ekfHealth, gps: gpsH, vibration: vibeHealthAll, battery: battH } = verdict.health;
  const VerdictIcon = verdict.cls === "go" ? ShieldCheck : verdict.cls === "wait" ? Activity : ShieldAlert;

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Preflight Check</h1>
          <p>Live health the autopilot reports about itself — sensors, state estimate, GPS, vibration and battery — rolled into one go / no-go view.</p>
        </div>
        <span className={`pill ${status === "connected" ? "ok" : "warn"} plain`}>{vehicle!.firmwareLabel} · sys {vehicle!.sysid}</span>
      </header>

      <div className={`pf-verdict ${verdict.cls}`} role="status">
        <VerdictIcon />
        <div>
          <strong>{verdict.title}</strong>
          <span>{verdict.note}</span>
          {verdict.reasons.length > 1 && (
            <ul className="pf-reasons">
              {verdict.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
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
          {verdict.prearm.length === 0 ? (
            <p className="muted">{armed ? "The vehicle is armed; pre-arm checks passed." : "No pre-arm failure in the last minute. If the vehicle refuses to arm, its reason will appear here."}</p>
          ) : (
            <ul className="pf-prearm">
              {verdict.prearm.map((t) => (
                <li key={t} className="error">{t}</li>
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
