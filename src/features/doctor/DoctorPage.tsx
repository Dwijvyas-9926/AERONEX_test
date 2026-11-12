import { BatteryMedium, Compass, Radar, Vibrate } from "lucide-react";
import { ConnectPrompt } from "../../components/ui/ConnectPrompt";
import { Activity, ArrowRight, CheckCircle2, ChevronDown, HelpCircle, Info, RefreshCw, ShieldX, Stethoscope, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { useRequireParams } from "../calibration/common";
import { AskDoctor } from "./AskDoctor";
import { DOCTOR_PARAMS, type Finding, runDiagnostics, type Severity, summarize } from "./diagnostics";

const SEV_META: Record<Severity, { label: string; Icon: typeof TriangleAlert }> = {
  critical: { label: "Critical", Icon: ShieldX },
  warn: { label: "Attention", Icon: TriangleAlert },
  info: { label: "Note", Icon: Info },
  ok: { label: "Healthy", Icon: CheckCircle2 },
};

const VERDICT_META = {
  grounded: { title: "Do not fly", sub: "Critical issues need fixing first.", cls: "bad" },
  caution: { title: "Fly with caution", sub: "No blockers, but some things want attention.", cls: "warn" },
  ready: { title: "Looking healthy", sub: "Every check the vehicle reports is passing.", cls: "ok" },
  unknown: { title: "Scanning…", sub: "Waiting for the vehicle to report its health.", cls: "idle" },
} as const;

function FindingCard({ f }: { f: Finding }) {
  const { Icon } = SEV_META[f.severity];
  return (
    <div className={`dr-finding ${f.severity}`}>
      <div className="dr-finding-ic"><Icon size={18} /></div>
      <div className="dr-finding-body">
        <div className="dr-finding-head">
          <span className="dr-finding-title">{f.title}</span>
          <span className="dr-area">{f.area}</span>
          {f.metric && <span className="dr-metric">{f.metric}</span>}
        </div>
        <p className="dr-detail">{f.detail}</p>
        {f.fix && <p className="dr-fix"><strong>Fix:</strong> {f.fix}</p>}
        {f.link && <Link className="dr-link" to={f.link.to}>{f.link.label} <ArrowRight size={14} /></Link>}
      </div>
    </div>
  );
}

export function DoctorPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const connected = !!vehicle && (status === "connected" || status === "stale");
  const canSend = !!vehicle && status === "connected";
  useRequireParams(DOCTOR_PARAMS, canSend);

  const paramCount = useParams((s) => s.received);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [lastRun, setLastRun] = useState(0);
  const [showHealthy, setShowHealthy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!connected) {
      setFindings([]);
      return;
    }
    const run = () => {
      const link = useLink.getState();
      const params = useParams.getState().values;
      setFindings(
        runDiagnostics({
          telemetry: link.telemetry,
          params,
          armed: link.vehicle?.armed ?? false,
          events: link.events,
          now: Date.now(),
        }),
      );
      setLastRun(Date.now());
    };
    run();
    const id = setInterval(run, 1500);
    return () => clearInterval(id);
  }, [connected]);

  const summary = useMemo(() => summarize(findings), [findings]);
  const issues = findings.filter((f) => f.severity !== "ok");
  const healthy = findings.filter((f) => f.severity === "ok");
  const v = VERDICT_META[summary.verdict];

  if (!connected) {
    return (
      <div className="page-pad">
        <header className="page-head">
          <div>
            <h1>Drone Doctor</h1>
            <p>A full health scan of your aircraft — it reads the autopilot's own signals and tells you, in plain words, what's wrong and how to fix it.</p>
          </div>
        </header>
        <ConnectPrompt
          title="Connect an aircraft to run a health scan"
          items={[
            { icon: Vibrate, title: "Vibration and clipping", detail: "Whether the airframe is shaking the sensors, and on which axis." },
            { icon: Compass, title: "Compass and GPS", detail: "Interference, fix quality and how many satellites are in use." },
            { icon: Radar, title: "Position estimate", detail: "How far the autopilot trusts its own idea of where it is." },
            { icon: BatteryMedium, title: "Power", detail: "Voltage, current and sag — each finding with the fix for it." },
          ]}
        >
          The Doctor reads the autopilot's own signals and says, in plain words, what is wrong and how to fix it. It
          only ever reports what a real aircraft sends, so there is nothing to diagnose until one is linked.
        </ConnectPrompt>
      </div>
    );
  }

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Drone Doctor</h1>
          <p>Live diagnosis from {vehicle!.firmwareLabel}. Each finding explains the cause and the fix — follow the link to the screen that resolves it.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setLastRun(Date.now())} title="Diagnostics refresh automatically every 1.5s">
          <RefreshCw size={15} /> Scanning live
        </button>
      </header>

      <section className="dr-help">
        <button className="dr-help-toggle" onClick={() => setShowHelp((s) => !s)} aria-expanded={showHelp}>
          <HelpCircle size={16} /> What am I looking at? <ChevronDown size={15} className={showHelp ? "open" : ""} />
        </button>
        {showHelp && (
          <div className="dr-help-body">
            <p>The Doctor re-scans your connected aircraft every second or two and reports anything outside ArduPilot's safe limits. Read it top to bottom:</p>
            <ul>
              <li><strong>Health score &amp; verdict</strong> — the headline. <em>Do not fly</em> means something critical needs fixing; <em>Fly with caution</em> means no blockers but things to watch; <em>Looking healthy</em> means every check passed.</li>
              <li><strong>Each finding card</strong> — a specific issue with its measured value, the likely <strong>cause</strong>, a <strong>Fix</strong>, and a link to the screen that resolves it. The most serious issues are listed first.</li>
              <li><strong>Passing checks</strong> — collapsed at the bottom; expand them to see everything that's currently healthy.</li>
            </ul>
            <p>It watches eight areas: vibration, state estimation (EKF), compass, GPS, power, sensors, configuration, and pre-arm messages. It reads the autopilot's own signals — it never overrides the vehicle's own pre-arm checks.</p>
            <p className="dr-help-note">Indoors, GPS and compass will flag (no clear sky view, nearby metal) — that's expected. The pre-arm section fills in once you actually try to arm.</p>
          </div>
        )}
      </section>

      <div className="dr-layout">
        <div className="dr-main">
      <section className={`dr-verdict ${v.cls}`}>
        <div className="dr-score">
          <div className="dr-score-ring" style={{ ["--pct" as string]: `${summary.score}` }}>
            <span>{findings.length ? summary.score : "—"}</span>
            <small>health</small>
          </div>
        </div>
        <div className="dr-verdict-text">
          <div className="dr-verdict-head">
            <Stethoscope size={18} />
            <h2>{v.title}</h2>
          </div>
          <p>{v.sub}</p>
          <div className="dr-counts">
            {summary.critical > 0 && <span className="dr-chip critical"><ShieldX size={13} /> {summary.critical} critical</span>}
            {summary.warn > 0 && <span className="dr-chip warn"><TriangleAlert size={13} /> {summary.warn} to address</span>}
            {summary.info > 0 && <span className="dr-chip info"><Info size={13} /> {summary.info} note{summary.info === 1 ? "" : "s"}</span>}
            {summary.ok > 0 && <span className="dr-chip ok"><CheckCircle2 size={13} /> {summary.ok} healthy</span>}
          </div>
        </div>
      </section>

      {findings.length === 0 && (
        <div className="callout" style={{ marginTop: "var(--s4)" }}>
          <Activity size={16} />
          <span>Waiting for the vehicle to report telemetry and parameters… If this stays empty, open Connection and confirm data streams are flowing.{paramCount > 0 ? ` (${paramCount} parameters loaded)` : ""}</span>
        </div>
      )}

      {issues.length > 0 && (
        <div className="dr-list">
          {issues.map((f) => <FindingCard key={f.id} f={f} />)}
        </div>
      )}

      {issues.length === 0 && findings.length > 0 && (
        <div className="dr-allclear">
          <CheckCircle2 size={22} />
          <div>
            <strong>No problems found.</strong>
            <span>Every signal the autopilot is reporting is within healthy limits. Keep an eye here during your first hover.</span>
          </div>
        </div>
      )}

      {healthy.length > 0 && (
        <div className="dr-healthy">
          <button className="dr-healthy-toggle" onClick={() => setShowHealthy((s) => !s)} aria-expanded={showHealthy}>
            <ChevronDown size={16} className={showHealthy ? "open" : ""} />
            {showHealthy ? "Hide" : "Show"} {healthy.length} passing check{healthy.length === 1 ? "" : "s"}
          </button>
          {showHealthy && <div className="dr-list">{healthy.map((f) => <FindingCard key={f.id} f={f} />)}</div>}
        </div>
      )}
        </div>
        <div className="dr-side">
          <AskDoctor findings={findings} />
        </div>
      </div>

      <p className="cal-foot muted">
        <Stethoscope size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        Thresholds follow ArduPilot's published guidance (vibration, EKF variance, compass interference, GPS). The Doctor reads the same signals your autopilot uses — it never overrides the vehicle's own pre-arm checks. {lastRun > 0 ? `Last scan ${new Date(lastRun).toLocaleTimeString()}.` : ""}
      </p>
    </div>
  );
}
