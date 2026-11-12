import { FileDown, ListTree, PencilLine } from "lucide-react";
import { ConnectPrompt } from "../../components/ui/ConnectPrompt";
import { ChevronRight, Download, Loader2, RotateCcw, Search, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { commandLink } from "../../services/link/commandLink";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { useParamEdits, type ParamEdits } from "../common/useParamEdits";

const trimNum = (v: number) => (Number.isInteger(v) ? String(v) : parseFloat(v.toFixed(6)).toString());

export function FullParamsPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const values = useParams((s) => s.values);
  const count = useParams((s) => s.count);
  const received = useParams((s) => s.received);
  const connected = !!vehicle && (status === "connected" || status === "stale");
  const canSend = !!vehicle && status === "connected";
  const edits = useParamEdits();

  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [requested, setRequested] = useState(false);

  // Pull the full list once when the link is ready.
  useEffect(() => {
    if (canSend && !requested && received === 0) {
      setRequested(true);
      void commandLink.requestAllParams();
    }
  }, [canSend, requested, received]);

  const names = useMemo(() => Object.keys(values).sort(), [values]);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of names) {
      const g = n.split("_")[0];
      (m.get(g) ?? m.set(g, []).get(g)!).push(n);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [names]);

  const q = search.trim().toUpperCase();
  const matches = useMemo(() => (q ? names.filter((n) => n.includes(q)).slice(0, 300) : []), [q, names]);

  const refresh = () => {
    if (!canSend) return;
    setRequested(true);
    void commandLink.requestAllParams();
  };

  // Save every loaded parameter to a Mission-Planner-compatible .param file.
  const saveToFile = () => {
    if (!names.length) return;
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const header =
      `# AERONEX parameter file\n` +
      `# ${vehicle?.firmwareLabel ?? "MAVLink"} · system ${vehicle?.sysid ?? "?"} · ${d.toISOString()}\n` +
      `# ${names.length} parameters${edits.count ? " — note: unsaved edits in the app are NOT included" : ""}\n`;
    const body = names.map((n) => `${n},${values[n]}`).join("\n");
    const blob = new Blob([header + body + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aeronex-params-${stamp}.param`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!connected) {
    return (
      <div className="page-pad">
        <header className="page-head">
          <div>
            <h1>Parameters</h1>
            <p>Every ArduPilot parameter on the vehicle, searchable and editable — change advanced settings directly.</p>
          </div>
        </header>
        <ConnectPrompt
          title="Connect an aircraft to read its parameters"
          items={[
            { icon: ListTree, title: "Every parameter, grouped", detail: "The full list from the autopilot, searchable by name." },
            { icon: PencilLine, title: "Staged edits", detail: "Change values freely; nothing is written until you press Upload." },
            { icon: FileDown, title: "A file you can keep", detail: "Save the whole set as a .param file other ground stations can open." },
          ]}
        >
          The parameter list lives on the flight controller and is downloaded when it connects. Lost messages are
          asked for again, so the list arrives whole even over a telemetry radio.
        </ConnectPrompt>
      </div>
    );
  }

  const downloading = count != null && received < count;

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Parameters</h1>
          <p>{received.toLocaleString()}{count ? ` of ${count.toLocaleString()}` : ""} parameters from {vehicle!.firmwareLabel}. Edit a value, then upload.</p>
        </div>
      </header>

      <div className="callout warn" style={{ marginBottom: "var(--s4)" }}>
        <TriangleAlert />
        <span>These are raw autopilot parameters. A wrong value can stop the vehicle arming or flying safely — change only what you understand, and note the original first. Some parameters need a reboot to take effect.</span>
      </div>

      <div className="pid-actionbar">
        <div className="fp-search">
          <Search size={16} />
          <input className="input" placeholder="Search parameters (e.g. MOT_, COMPASS_USE)" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="pid-actionbar-btns">
          <button className="btn btn-ghost" disabled={names.length === 0} onClick={saveToFile} title="Save all parameters to a .param file"><Download size={15} /> Save to file</button>
          <button className="btn btn-ghost" disabled={!canSend || downloading} onClick={refresh} title="Re-download all parameters"><RotateCcw size={15} /> Refresh</button>
          <button className="btn btn-ghost" disabled={!edits.count || edits.uploading} onClick={edits.revert}>Revert</button>
          <button className="btn btn-primary" disabled={!canSend || !edits.count || edits.uploading} onClick={() => void edits.upload()}>
            {edits.uploading ? <Loader2 className="spin" /> : <Upload />} Upload{edits.count ? ` (${edits.count})` : ""}
          </button>
        </div>
      </div>

      {downloading && (
        <div className="fp-progress">
          <Loader2 className="spin" size={15} /> Downloading parameters… {received.toLocaleString()} / {count!.toLocaleString()}
        </div>
      )}

      {names.length === 0 && !downloading && <p className="muted">Waiting for parameters…</p>}

      <section className="panel fp-panel">
        {q ? (
          matches.length === 0 ? (
            <p className="muted" style={{ padding: "var(--s4)" }}>No parameter matches “{search}”.</p>
          ) : (
            <div className="fp-list">
              {matches.map((n) => <ParamRow key={n} name={n} edits={edits} disabled={!canSend} />)}
              {matches.length === 300 && <p className="muted fp-cap">Showing the first 300 matches — narrow your search to see more.</p>}
            </div>
          )
        ) : (
          groups.map(([g, gnames]) => {
            const isOpen = open.has(g);
            const changed = gnames.filter((n) => n in edits.edits).length;
            return (
              <div key={g} className="fp-group">
                <button
                  className="fp-group-head"
                  aria-expanded={isOpen}
                  onClick={() => setOpen((s) => { const n = new Set(s); n.has(g) ? n.delete(g) : n.add(g); return n; })}
                >
                  <ChevronRight size={16} className={`fp-caret${isOpen ? " open" : ""}`} />
                  <strong>{g}</strong>
                  <span className="fp-group-count">{gnames.length}</span>
                  {changed > 0 && <span className="fp-mod">{changed} edited</span>}
                </button>
                {isOpen && <div className="fp-list">{gnames.map((n) => <ParamRow key={n} name={n} edits={edits} disabled={!canSend} />)}</div>}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function ParamRow({ name, edits, disabled }: { name: string; edits: ParamEdits; disabled: boolean }) {
  const value = useParams((s) => s.values[name]);
  const pending = useParams((s) => s.pending[name]);
  const staged = edits.edits[name];
  const modified = staged !== undefined && (value === undefined || Math.abs(staged - value) > 1e-9);
  const shown = staged ?? value ?? 0;
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? trimNum(shown);

  const commit = () => {
    if (draft == null) return;
    const v = Number(draft);
    if (Number.isFinite(v) && draft.trim() !== "") edits.setEdit(name, v);
    setDraft(null);
  };

  return (
    <div className={`fp-row${modified ? " modified" : ""}`}>
      <span className="fp-name" title={name}>{name}</span>
      {modified && value !== undefined && <span className="fp-was">was {trimNum(value)}</span>}
      {pending?.state === "writing" && <Loader2 size={13} className="spin fp-saving" />}
      {pending?.state === "failed" && <span className="pwrite failed" title="Write not confirmed"><TriangleAlert size={12} /></span>}
      <input
        className="input fp-input"
        type="number"
        inputMode="decimal"
        value={text}
        disabled={disabled || value === undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
