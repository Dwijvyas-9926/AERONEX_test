import { Activity, Cable } from "lucide-react";
import { Link } from "react-router-dom";
import { useNow } from "../../hooks/useNow";
import { isPortOpen, useLink } from "../../state/linkStore";
import { ago, clockTime } from "../../utils/format";
import { LINK_STATUS } from "../connection/linkStatus";

export function TelemetryPage() {
  const status = useLink((s) => s.status);
  const stats = useLink((s) => s.stats);
  const events = useLink((s) => s.events);
  const frames = useLink((s) => s.recentFrames);
  const last = useLink((s) => s.lastHeartbeatAt);
  const vehicle = useLink((s) => s.vehicle);
  const now = useNow(1000);
  const view = LINK_STATUS[status];
  const rates = Object.entries(stats.rates).sort((a, b) => b[1].hz - a[1].hz);
  const hasData = isPortOpen(status) || stats.framesOk > 0;

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Telemetry &amp; Diagnostics</h1>
          <p>What is actually arriving on the link: message rates, vehicle events and the raw frame stream.</p>
        </div>
        <div className="actions">
          <span className="pill accent plain">Source: physical link</span>
          <span className={`pill ${view.tone}${view.live ? " live" : ""}`}>{view.label}</span>
        </div>
      </header>

      {!hasData ? (
        <section className="panel">
          <div className="empty">
            <Activity />
            <h3>No link data yet</h3>
            <p>Connect a flight controller to see message rates, heartbeat health and vehicle messages here. Simulator telemetry will appear here too, labelled as virtual.</p>
            <Link className="btn btn-primary" to="/connection">
              <Cable /> Open Vehicle Connection
            </Link>
          </div>
        </section>
      ) : (
        <div className="split">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h3>Messages</h3>
                <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
                  {rates.length} types, {stats.framesOk.toLocaleString()} valid frames
                </span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Message</th>
                      <th className="num">Rate</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rates.map(([name, r]) => (
                      <tr key={name}>
                        <td>{name}</td>
                        <td className="num">{r.hz.toFixed(1)} Hz</td>
                        <td className="num">{r.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h3>Latest frames</h3>
                <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
                  CRC-validated, newest first
                </span>
              </div>
              <div className="table-wrap" style={{ maxHeight: 300 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Message</th>
                      <th className="num">Sys</th>
                      <th className="num">Comp</th>
                      <th className="num">Seq</th>
                      <th className="num">Bytes</th>
                      <th className="num">Ver</th>
                    </tr>
                  </thead>
                  <tbody>
                    {frames.map((f, i) => (
                      <tr key={`${f.at}-${f.seq}-${i}`}>
                        <td className="num" style={{ textAlign: "left" }}>
                          {clockTime(f.at)}
                        </td>
                        <td>{f.name}</td>
                        <td className="num">{f.sysid}</td>
                        <td className="num">{f.compid}</td>
                        <td className="num">{f.seq}</td>
                        <td className="num">{f.len}</td>
                        <td className="num">v{f.version}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <h3>Link health</h3>
              </div>
              <dl className="readouts" style={{ margin: 0, borderRadius: 0 }}>
                <div className="readout">
                  <dt>Last heartbeat</dt>
                  <dd style={{ fontSize: "var(--t-md)" }}>{ago(last, now)}</dd>
                </div>
                <div className="readout">
                  <dt>Vehicle</dt>
                  <dd style={{ fontSize: "var(--t-md)" }}>{vehicle ? `System ${vehicle.sysid}` : "None"}</dd>
                </div>
                <div className="readout">
                  <dt>CRC failures</dt>
                  <dd style={{ color: stats.crcErrors > 0 ? "var(--warn)" : undefined }}>{stats.crcErrors.toLocaleString()}</dd>
                </div>
                <div className="readout">
                  <dt>Unknown ids</dt>
                  <dd>{stats.unknownMsg.toLocaleString()}</dd>
                </div>
              </dl>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h3>Events and vehicle messages</h3>
              </div>
              {events.length === 0 ? (
                <p className="muted" style={{ padding: "var(--s4) var(--s5)", fontSize: "var(--t-sm)" }}>
                  Nothing yet.
                </p>
              ) : (
                <ul className="event-log" style={{ maxHeight: 520 }}>
                  {events.map((e) => (
                    <li key={e.id} className={e.level}>
                      <span className="num">{clockTime(e.at)}</span>
                      <span>{e.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
