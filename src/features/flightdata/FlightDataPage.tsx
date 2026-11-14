import { ConnectPrompt } from "../../components/ui/ConnectPrompt";
import { BatteryMedium, Compass, Gauge, MountainSnow, Navigation, Radio, Satellite, TrendingUp, Zap } from "lucide-react";
import { useNow } from "../../hooks/useNow";
import { useLink } from "../../state/linkStore";
import { useSettings } from "../../state/settingsStore";
import { duration, GPS_FIX, RAD } from "../../utils/format";
import { Pfd } from "./Pfd";

const STALE = 3000;

export function FlightDataPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const tel = useLink((s) => s.telemetry);
  const connectedAt = useLink((s) => s.connectedAt);
  const units = useSettings((s) => s.units);
  const now = useNow(200);
  const connected = !!vehicle && (status === "connected" || status === "stale");

  if (!connected) {
    return (
      <div className="page-pad">
        <header className="page-head">
          <div>
            <h1>Flight Data</h1>
            <p>A full primary flight display driven by live telemetry — attitude, heading, speed and altitude at a glance.</p>
          </div>
        </header>
        <ConnectPrompt
          title="Connect an aircraft to bring the display live"
          items={[
            { icon: Navigation, title: "Attitude and heading", detail: "An artificial horizon with roll, pitch and a compass tape." },
            { icon: Gauge, title: "Speed and height", detail: "Ground speed, climb rate and height above the take-off point." },
            { icon: Satellite, title: "GPS and battery", detail: "Fix, satellites, voltage and charge, with stale readings marked." },
          ]}
        >
          A primary flight display, drawn from telemetry as it arrives. Every needle moves on what the aircraft
          reports and nothing else, so the display stays blank until there is an aircraft to report.
        </ConnectPrompt>
      </div>
    );
  }

  const att = tel.attitude;
  const hud = tel.hud;
  const pos = tel.position;
  const gps = tel.gps;
  const batt = tel.battery;
  const rc = tel.rc;
  const hasData = !!att;
  const stale = !att || now - att.at > STALE;

  const roll = att ? att.value.roll * RAD : 0;
  const pitch = att ? att.value.pitch * RAD : 0;
  const heading = hud?.value.heading ?? pos?.value.heading ?? (att ? (((att.value.yaw * RAD) % 360) + 360) % 360 : 0);
  const imperial = units === "imperial";
  const spUnit = imperial ? "mph" : "m/s";
  const alUnit = imperial ? "ft" : "m";
  const spVal = (hud?.value.groundspeed ?? 0) * (imperial ? 2.23694 : 1);
  const alVal = (pos?.value.relAlt ?? hud?.value.alt ?? 0) * (imperial ? 3.28084 : 1);
  const climb = hud?.value.climb ?? 0;
  const throttle = hud?.value.throttle ?? 0;
  const remaining = batt?.value.remaining ?? null;

  const num = (v: number, dp = 0) => v.toFixed(dp);

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Flight Data</h1>
          <p>Live primary flight display — {vehicle!.firmwareLabel}, system {vehicle!.sysid}.</p>
        </div>
      </header>

      <section className="fd-cockpit on-navy">
        <div className="fd-ribbon">
          <div className="fd-ribbon-mode">
            <span className="fd-ribbon-label">Mode</span>
            <strong>{vehicle!.mode ?? "—"}</strong>
          </div>
          <div className="fd-ribbon-right">
            <span className={`fd-arm ${vehicle!.armed ? "armed" : "safe"}`}>{vehicle!.armed ? "Armed" : "Disarmed"}</span>
            <span className={`fd-link ${status === "connected" ? "live" : "stale"}`}>
              <i /> {status === "connected" ? "Live link" : "Stale"}
            </span>
            {connectedAt && <span className="fd-time">{duration(now - connectedAt)}</span>}
            {remaining != null && (
              <span className={`fd-batt ${remaining < 20 ? "low" : ""}`}>
                <BatteryMedium size={15} /> {remaining}%
              </span>
            )}
          </div>
        </div>
        <div className="fd-pfd-wrap">
          <Pfd roll={roll} pitch={pitch} heading={heading} speed={spVal} speedUnit={spUnit} altitude={alVal} altUnit={alUnit} climb={climb} throttle={throttle} stale={stale} hasData={hasData} />
        </div>
      </section>

      <div className="fd-group-label">Navigation</div>
      <div className="fd-tiles">
        <Tile icon={Navigation} label="Heading" value={hasData ? num(((heading % 360) + 360) % 360) : "—"} unit="°" />
        <Tile icon={Gauge} label="Ground speed" value={hud ? num(spVal, 1) : "—"} unit={spUnit} />
        <Tile icon={MountainSnow} label="Altitude" value={pos || hud ? num(alVal, imperial ? 0 : 1) : "—"} unit={`${alUnit} rel`} />
        <Tile icon={TrendingUp} label="Climb rate" value={hud ? `${climb >= 0 ? "+" : ""}${num(climb, 1)}` : "—"} unit="m/s" />
      </div>

      <div className="fd-group-label">Power &amp; links</div>
      <div className="fd-tiles">
        <Tile icon={BatteryMedium} label="Battery" value={batt?.value.voltage != null ? num(batt.value.voltage, 2) : "—"} unit={remaining != null ? `V · ${remaining}%` : "V"} tone={remaining != null && remaining < 20 ? "bad" : undefined} />
        <Tile icon={Zap} label="Current" value={batt?.value.current != null ? num(batt.value.current, 1) : "—"} unit="A" />
        <Tile icon={Satellite} label="GPS" value={gps ? (GPS_FIX[gps.value.fixType] ?? "—") : "—"} unit={gps?.value.satellites != null ? `${gps.value.satellites} sats` : ""} tone={gps && gps.value.fixType < 3 ? "bad" : undefined} />
        <Tile icon={Radio} label="RC channels" value={rc ? num(rc.value.count) : "—"} unit="ch" />
        <Tile icon={Compass} label="Roll / pitch" value={hasData ? `${num(roll, 1)} / ${num(pitch, 1)}` : "—"} unit="°" />
        <Tile icon={Gauge} label="Throttle" value={hud ? num(throttle) : "—"} unit="%" />
      </div>

      <p className="cal-foot muted">Every value is shown exactly as the vehicle reports it. The display dims when telemetry goes stale (no update for {STALE / 1000} s).</p>
    </div>
  );
}

function Tile({ icon: Icon, label, value, unit, tone }: { icon: typeof Gauge; label: string; value: string; unit?: string; tone?: "bad" }) {
  return (
    <div className="fd-tile">
      <span className="fd-chip"><Icon size={16} /></span>
      <div className="fd-tile-body">
        <span className="fd-tile-label">{label}</span>
        <span className="fd-tile-val">
          <strong className={tone === "bad" ? "fd-bad" : undefined}>{value}</strong>
          {unit && <em>{unit}</em>}
        </span>
      </div>
    </div>
  );
}
