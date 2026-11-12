import { Check, Copy, Info, Plus, Trash } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLink } from "../../state/linkStore";
import { confirmAction, notify } from "../../state/notifyStore";
import { useProfiles } from "../../state/profileStore";
import { BOARD_LABELS, BOARD_NOTES, FIRMWARE_LABELS, FRAME_LABELS, type BoardId, type DeclaredFirmware, type FrameType, type VehicleProfile } from "../../vehicle/types";

type Draft = Pick<VehicleProfile, "name" | "frame" | "firmware" | "board" | "massGrams" | "diagonalMm" | "notes">;

const toDraft = (p: VehicleProfile): Draft => ({
  name: p.name,
  frame: p.frame,
  firmware: p.firmware,
  board: p.board,
  massGrams: p.massGrams,
  diagonalMm: p.diagonalMm,
  notes: p.notes,
});

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function Editor({ profile, onDirty }: { profile: VehicleProfile; onDirty: (d: boolean) => void }) {
  const update = useProfiles((s) => s.update);
  const remove = useProfiles((s) => s.remove);
  const duplicate = useProfiles((s) => s.duplicate);
  const setActive = useProfiles((s) => s.setActive);
  const activeId = useProfiles((s) => s.activeId);
  const count = useProfiles((s) => s.profiles.length);
  const linked = useLink((s) => s.vehicle);
  const [d, setD] = useState<Draft>(() => toDraft(profile));
  const [massText, setMassText] = useState(profile.massGrams?.toString() ?? "");
  const [diagText, setDiagText] = useState(profile.diagonalMm?.toString() ?? "");

  const draft: Draft = { ...d, massGrams: numOrNull(massText), diagonalMm: numOrNull(diagText) };
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(profile));
  const nameError = draft.name.trim() === "" ? "Give the aircraft a name." : null;
  const massError = massText.trim() !== "" && draft.massGrams === null ? "Enter a positive number of grams." : null;
  const diagError = diagText.trim() !== "" && draft.diagonalMm === null ? "Enter a positive number of millimetres." : null;
  const invalid = !!(nameError || massError || diagError);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const mismatch =
    linked && draft.firmware !== "unsure" && linked.firmware !== "other" && linked.firmware !== draft.firmware
      ? `The connected vehicle reports ${linked.firmwareLabel}, but this profile says ${FIRMWARE_LABELS[draft.firmware]}. The app always trusts what the vehicle reports.`
      : null;

  const save = () => {
    update(profile.id, { ...draft, name: draft.name.trim() });
    notify("success", "Profile saved", `${draft.name.trim()} is stored in this browser.`);
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{profile.name}</h3>
        <div style={{ display: "flex", gap: 6 }}>
          {activeId === profile.id ? (
            <span className="pill ok plain">
              <Check size={13} /> Active vehicle
            </span>
          ) : (
            <button className="btn" onClick={() => setActive(profile.id)}>
              Make active
            </button>
          )}
        </div>
      </div>
      <div className="panel-body form-grid">
        <label className="field span2">
          <span>Name</span>
          <input className="input" value={d.name} maxLength={48} onChange={(e) => setD({ ...d, name: e.target.value })} aria-invalid={!!nameError} />
          {nameError && <small style={{ color: "var(--danger)" }}>{nameError}</small>}
        </label>
        <label className="field">
          <span>Frame</span>
          <select className="select" value={d.frame} onChange={(e) => setD({ ...d, frame: e.target.value as FrameType })}>
            {Object.entries(FRAME_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Flight controller</span>
          <select className="select" value={d.board} onChange={(e) => setD({ ...d, board: e.target.value as BoardId })}>
            {Object.entries(BOARD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <small>{BOARD_NOTES[d.board]}</small>
        </label>
        <label className="field">
          <span>Firmware you plan to run</span>
          <select className="select" value={d.firmware} onChange={(e) => setD({ ...d, firmware: e.target.value as DeclaredFirmware })}>
            {Object.entries(FIRMWARE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <small>A note for you. The connected vehicle&rsquo;s heartbeat decides what the app actually does.</small>
        </label>
        <div />
        <label className="field">
          <span>All-up mass (g)</span>
          <input className="input" inputMode="numeric" value={massText} placeholder="e.g. 2400" onChange={(e) => setMassText(e.target.value)} aria-invalid={!!massError} />
          {massError ? <small style={{ color: "var(--danger)" }}>{massError}</small> : <small>Used by the simulator&rsquo;s flight model.</small>}
        </label>
        <label className="field">
          <span>Motor-to-motor diagonal (mm)</span>
          <input className="input" inputMode="numeric" value={diagText} placeholder="e.g. 550" onChange={(e) => setDiagText(e.target.value)} aria-invalid={!!diagError} />
          {diagError && <small style={{ color: "var(--danger)" }}>{diagError}</small>}
        </label>
        <label className="field span2">
          <span>Notes</span>
          <textarea className="input" value={d.notes} maxLength={2000} onChange={(e) => setD({ ...d, notes: e.target.value })} placeholder="Payload, wiring, anything you want to remember." />
        </label>
        {mismatch && (
          <div className="callout warn span2">
            <Info />
            <span>{mismatch}</span>
          </div>
        )}
        <div className="callout span2">
          <Info />
          <span>
            3D model: the default quadcopter. Import your own assembly in Digital Twin. Profiles live in this
            browser&rsquo;s storage; clearing site data removes them.
          </span>
        </div>
      </div>
      <div className="form-foot">
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              const c = duplicate(profile.id);
              if (c) notify("success", "Profile duplicated", `Created ${c.name}.`);
            }}
          >
            <Copy /> Duplicate
          </button>
          <button
            className="btn btn-ghost"
            disabled={count <= 1}
            title={count <= 1 ? "Keep at least one profile" : undefined}
            onClick={async () => {
              const ok = await confirmAction({
                title: `Delete ${profile.name}?`,
                body: "This removes the profile from this browser. It does not change anything on a flight controller. This can't be undone.",
                confirmLabel: "Delete profile",
                tone: "danger",
              });
              if (ok) {
                remove(profile.id);
                notify("info", "Profile deleted", `${profile.name} was removed.`);
              }
            }}
          >
            <Trash /> Delete
          </button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {dirty && <span className="muted" style={{ fontSize: "var(--t-sm)" }}>Unsaved changes</span>}
          <button className="btn" disabled={!dirty} onClick={() => setD(toDraft(profile))}>
            Discard
          </button>
          <button className="btn btn-primary" disabled={!dirty || invalid} onClick={save}>
            Save profile
          </button>
        </div>
      </div>
    </section>
  );
}

export function VehicleConfigPage() {
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeId);
  const create = useProfiles((s) => s.create);
  const [selected, setSelected] = useState<string | null>(activeId);
  const [dirty, setDirty] = useState(false);
  const current = useMemo(() => profiles.find((p) => p.id === selected) ?? profiles[0] ?? null, [profiles, selected]);

  const pick = async (id: string) => {
    if (id === current?.id) return;
    if (dirty) {
      const ok = await confirmAction({ title: "Discard unsaved changes?", body: "You have edits to this profile that haven't been saved.", confirmLabel: "Discard changes", tone: "danger" });
      if (!ok) return;
    }
    setSelected(id);
  };

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Aircraft Profile</h1>
          <p>A profile for each aircraft you fly. Profiles describe your airframe; they never overwrite what a connected flight controller reports.</p>
        </div>
        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (dirty) {
                const ok = await confirmAction({ title: "Discard unsaved changes?", body: "You have edits to this profile that haven't been saved.", confirmLabel: "Discard changes", tone: "danger" });
                if (!ok) return;
              }
              const p = create();
              setSelected(p.id);
              notify("success", "Profile created", "Name it and save.");
            }}
          >
            <Plus /> New profile
          </button>
        </div>
      </header>
      <div className="profiles">
        <section className="panel">
          <div className="panel-head">
            <h3>Profiles</h3>
            <span className="muted num">{profiles.length}</span>
          </div>
          <div className="profile-list" role="listbox" aria-label="Vehicle profiles">
            {profiles.map((p) => (
              <button key={p.id} className="profile-item" role="option" aria-selected={p.id === current?.id} aria-current={p.id === current?.id} onClick={() => void pick(p.id)}>
                <span>
                  <strong>{p.name}</strong>
                  <span>
                    {FRAME_LABELS[p.frame]}, {BOARD_LABELS[p.board]}
                  </span>
                </span>
                {p.id === activeId && <span className="pill ok plain">Active</span>}
              </button>
            ))}
          </div>
        </section>
        {current ? (
          <Editor key={current.id} profile={current} onDirty={setDirty} />
        ) : (
          <section className="panel">
            <div className="empty">
              <h3>No profiles</h3>
              <p>Create a profile to describe your aircraft.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
