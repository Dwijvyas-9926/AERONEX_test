import { confirmAction, notify } from "../../state/notifyStore";
import { GRAPHICS, useSettings, type GraphicsPreset, type MotionPref, type Units } from "../../state/settingsStore";

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage() {
  const s = useSettings();
  return (
    <div className="page-pad" style={{ maxWidth: 920 }}>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Saved in this browser and applied immediately.</p>
        </div>
      </header>
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h3>Display</h3>
          </div>
          <div className="setting">
            <div>
              <strong>Motion</strong>
              <p>Reduced motion stops the hero flight, page transitions and pulsing indicators. System follows your operating system setting.</p>
            </div>
            <Segmented<MotionPref>
              label="Motion"
              value={s.motion}
              onChange={(v) => s.set("motion", v)}
              options={[
                ["system", "System"],
                ["reduced", "Reduced"],
                ["full", "Full"],
              ]}
            />
          </div>
          <div className="setting">
            <div>
              <strong>Graphics quality</strong>
              <p>{GRAPHICS[s.graphics].detail}</p>
            </div>
            <Segmented<GraphicsPreset>
              label="Graphics quality"
              value={s.graphics}
              onChange={(v) => s.set("graphics", v)}
              options={(Object.keys(GRAPHICS) as GraphicsPreset[]).map((k) => [k, GRAPHICS[k].label])}
            />
          </div>
          <div className="setting">
            <div>
              <strong>Units</strong>
              <p>Altitude and speed readouts. Protocol values are always metric internally.</p>
            </div>
            <Segmented<Units>
              label="Units"
              value={s.units}
              onChange={(v) => s.set("units", v)}
              options={[
                ["metric", "Metric"],
                ["imperial", "Imperial"],
              ]}
            />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Ask the Doctor (AI assistant)</h3>
          </div>
          <div className="setting">
            <div>
              <strong>Anthropic API key</strong>
              <p>Powers the Ask the Doctor chat on the Drone Doctor page. Stored only in this browser and sent only to Anthropic — AERONEX has no server. Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a>.</p>
            </div>
            <div className="set-ai-key">
              <input className="input" type="password" placeholder="sk-ant-…" value={s.aiKey} onChange={(e) => s.set("aiKey", e.target.value)} />
              {s.aiKey && <button className="btn btn-ghost" onClick={() => s.set("aiKey", "")} title="Remove stored key">Clear</button>}
            </div>
          </div>
          <div className="setting">
            <div>
              <strong>Model</strong>
              <p>Which Claude model answers. If you get a “model not available” error, try <code>claude-3-5-sonnet-latest</code>, or a newer model your account has access to.</p>
            </div>
            <>
              <input className="input" list="ai-models" value={s.aiModel} onChange={(e) => s.set("aiModel", e.target.value)} style={{ maxWidth: 280 }} aria-label="AI model" />
              <datalist id="ai-models">
                <option value="claude-3-5-sonnet-latest" />
                <option value="claude-3-5-haiku-latest" />
                <option value="claude-sonnet-4-5" />
                <option value="claude-opus-4-1" />
              </datalist>
            </>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Stored data</h3>
          </div>
          <div className="setting">
            <div>
              <strong>Reset app data</strong>
              <p>Removes vehicle profiles and settings from this browser. Nothing on any flight controller is changed.</p>
            </div>
            <button
              className="btn btn-danger"
              onClick={async () => {
                const ok = await confirmAction({
                  title: "Reset all app data?",
                  body: "Vehicle profiles and settings stored in this browser will be deleted. This can't be undone.",
                  confirmLabel: "Reset data",
                  tone: "danger",
                });
                if (!ok) return;
                localStorage.removeItem("avion.profiles.v1");
                localStorage.removeItem("avion.settings.v1");
                notify("info", "App data reset", "Reloading.");
                window.setTimeout(() => window.location.reload(), 600);
              }}
            >
              Reset data
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
