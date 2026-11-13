# AERONEX Ground Station

A web-based UAV ground control station, digital-twin workspace and flight
simulator for Pixhawk-class multicopters. It connects to real flight
controllers over MAVLink and is just as usable with no hardware attached.

This repository is **milestone 1 — the application foundation**. It is built so
the simulator, digital twin, calibration and command layers slot into the same
app rather than arriving as separate demos. What is real today, and what is
scaffolded, is listed honestly below and in the app itself.

---

## Quick start

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev      # start the dev server (prints a localhost URL)
```

Then open the printed URL in **Chrome, Edge or Opera on desktop** if you want to
connect real hardware (see Browser support). Everything except the hardware link
works in any modern browser.

```bash
npm run build    # type-check and produce a production build in dist/
npm run preview  # serve the production build locally
npm test         # run the protocol and link unit tests (Vitest)
```

---

## What works today

### Vehicle Connection — real, read-only
- **Web Serial** connection to a flight controller over **USB** or a
  **telemetry radio** exposed as a serial device.
- A from-scratch **MAVLink 1/2 parser** that CRC-validates every frame against
  the ArduPilot dialect's `CRC_EXTRA` table. Invalid frames are counted, not
  trusted.
- **Heartbeat-based vehicle discovery**: vehicle type, firmware family
  (ArduPilot / PX4 / other), flight mode, arming state and system status, all
  read from what the vehicle actually sends. A GCS/camera/companion heartbeat is
  never mistaken for the vehicle.
- Live **attitude, GPS, battery, position, HUD and RC** telemetry when the
  vehicle sends it, each stamped and flagged **stale** after 3 s.
- Honest states throughout: *waiting for heartbeat*, *no heartbeat* (with a
  baud-rate hint when bytes arrive but don't parse), *stale*, *lost*, *error*,
  each with recovery guidance.
- **The link is listen-only.** Nothing is ever written to the serial port, so
  the app cannot arm, change modes, spin motors or write parameters. Commands
  arrive in Phase 4 with acknowledgement tracking.

### Telemetry & Diagnostics — real
- Per-message rates, a CRC-validated raw frame table, link-health counters and
  a vehicle event/STATUSTEXT log.

### Vehicle Configuration — real
- Local **vehicle profiles** (frame, board, declared firmware, mass, dimensions,
  notes), persisted in the browser. Profiles describe *your* airframe and never
  override what a connected controller reports; a mismatch is flagged.

### Overview — real
- A live 3D hero: a procedural quadcopter flying a **scripted preview path**
  (clearly labelled as not live telemetry) over a procedural valley, with an
  attitude/heading/altitude instrument cluster driven by the same state.
- First-flight checklist, browser-capability check, and both operating modes.

### Settings — real
- Motion (respects `prefers-reduced-motion`), graphics preset, units, and a
  data reset.

### Digital Twin Studio — real (model import, orientation, test flight)
- Import your drone's assembly: **GLB, glTF, OBJ, STL**, or **STEP/STP**.
- STEP/STP is tessellated to a mesh **in the browser** by occt-import-js
  (OpenCascade in WebAssembly) — the file is never uploaded. Part names and
  per-part colours from the assembly are preserved.
- **Orientation**: pick which model axis is the nose and which is up (with
  common-export presets), auto-fit and scale. This is a visual correction only;
  it never changes autopilot parameters.
- **Test flight**: fly the imported model over a ground grid in three modes —
  *Inspect* (orbit + body-axis arrows), *Scripted* (an analytic figure-eight
  with attitude derived from the path), and *Manual* (keyboard kinematic
  control). Clearly labelled as a visual preview, not a validated physics model.
- The viewport renders imported models with the twin simulator's exact
  material scheme and lighting, so a model looks identical in both places.
- Orientation is set with intuitive Turn / Tilt / Roll buttons (90° steps), with
  a direct-axis fallback.
- The model persists with the vehicle profile: the descriptor on the profile,
  the raw bytes in IndexedDB, so it reloads after a refresh.

### Flight Simulator — your Avion digital twin, embedded
- The simulator is the **Avion digital twin exactly as authored** (the
  self-contained build provided): its own low-poly flood-valley world, the
  autonomous relief-mission flow (takeoff → route → drop-zone lock → delivery →
  return), live flight telemetry, battery/motor/GNSS panels, a route map, a
  D455 depth view, an exploded-view part inspector, and chase/orbit/overview/FPV
  cameras.
- It flies the model you import in Digital Twin Studio: the app hands the twin
  the imported geometry (as raw arrays, with your orientation baked in) and the
  twin rebuilds and re-materialises it by part name. With nothing imported it
  uses its built-in Avion.
- It is loaded verbatim in an isolated frame. The only changes to the original
  file: its three.js (r147) was vendored locally, its inline scripts were
  externalised (so it runs offline and within the app's sandbox), and it now
  accepts the app's model. No sim logic or visuals were altered.

### Calibration, Mission Planning, Logs — scaffolded
- Each has a finished screen that explains what it will do and in which phase,
  with no dead ends. True 6-DOF physics for the simulator is still future work.

---

## Browser support

The hardware link uses the **Web Serial API**, available in Chromium-based
desktop browsers (Chrome, Edge, Opera) on a secure context (`https://` or
`http://localhost`). Firefox and Safari don't implement it; the app detects this
and explains it rather than failing silently. The 3D views need **WebGL 2**.

## Target hardware

Designed for **Pixhawk 2.4.8**, **Holybro Pixhawk 6C Mini** and other
MAVLink-speaking controllers running **ArduPilot** or **PX4**. Board identity
(via `AUTOPILOT_VERSION`) and firmware-specific capability detection land with
the command layer in Phase 4. Hardware connectivity has **not** been verified
against a physical board in this environment — the protocol layer is validated
with real pymavlink-encoded frames instead (see Testing).

---

## Testing

```bash
npm test
```

The MAVLink parser and vehicle-session logic are covered by unit tests whose
fixtures are **real frames encoded by pymavlink** (heartbeats for ArduPilot,
PX4 and a GCS; attitude, sys_status, GPS and statustext; v1 and v2; split
across chunks; corrupted). The fixtures and the dialect tables in
`src/mavlink/dialect.generated.ts` are generated by `scripts/gen_dialect.py`
(needs Python + `pymavlink`); the generated files are committed so the app
builds without Python.

These tests validate the transport-independent code. They are **not** a
substitute for testing against a real flight controller.

---

## Architecture

```
src/
  app/            application shell, routing, cross-app link notifications
  components/     shell (sidebar, status bar, overlays) and shared UI
  features/       one folder per module (overview, connection, …)
  mavlink/        CRC, framing parser, payload decode, heartbeat interpretation
  services/       capability detection, serial link manager, vehicle session
  state/          Zustand stores: link, profiles, settings, notifications
  rendering/      coordinate frames, procedural terrain, the default quadcopter
  vehicle/        vehicle-profile types
  styles/         design tokens and CSS
```

Key boundaries:
- **Transport is separate from protocol is separate from UI.** The parser and
  `VehicleSession` take bytes and emit state with no React or serial knowledge.
- **Physical and (future) simulated vehicles have separate state.** The link
  store only ever describes a real serial connection.
- **Coordinate conventions live in one file** (`src/rendering/frames.ts`): a
  Y-up right-handed render frame and the autopilot's NED frame, with the
  conversions between them.

Stack: React 19, TypeScript, Vite, Three.js / React Three Fiber, Zustand,
Motion, occt-import-js (STEP). The Flight Simulator is the provided Avion twin
(three.js r147, vendored) loaded in a frame. Fonts (Manrope, Saira Semi Condensed) are
bundled, not fetched. The ~2 MB CAD-kernel WASM is lazy-loaded only on the
first STEP import.

---

## Safety notes

- The app is not a substitute for manufacturer documentation or approved flight
  procedures, and it is not flight-certified.
- A rendered interface is not a verified connection. Where hardware, firmware or
  a backend is required, the app says so instead of pretending.

## Roadmap

1. **Foundation & visual identity** — *this milestone*
2. Independent 3D flight simulator — **the provided Avion digital twin, embedded**
3. Digital Twin Studio (model import + orientation) — **done: STEP/mesh import + test flight**
4. Pixhawk command layer (stream requests, parameters, commands with ACKs)
5. Calibration & configuration (firmware-aware)
6. Integration, testing, refinement
7. Mission planning & flight-log analysis

## Maps and ground heights

Mission Planning draws the route on a real map over measured ground. Nothing
needs an account to work:

| What | Source | Terms |
| --- | --- | --- |
| Map engine | MapLibre GL JS | Open source (BSD) |
| Ground heights | Terrain Tiles on AWS Open Data (Mapzen; SRTM and other public surveys), about 30 m detail | Open, no key, may be kept offline; credit required |
| Default picture | Sentinel-2 cloudless 2016 by EOX, 10 m detail | CC BY 4.0, may be kept offline; credit required |
| Newer picture | Sentinel-2 cloudless 2024 by EOX | Non-commercial use only |
| Street map | OpenStreetMap's tile servers | View only: their policy forbids saving areas |
| Sharp satellite | MapTiler, with the user's own key | Their free plan is non-commercial; no bulk saving |
| Sharp satellite | Esri World Imagery | Works without a key; a published app should use an Esri account; no saving |

Sharper pictures need a provider key, entered in the map's Layers panel and
kept only in the browser. Tiles from the open sources are stored in the
browser as they are viewed, and "Save this area" stores a whole view, so a
saved field works with no internet.

Heights in a mission are metres above home, ArduCopter's default frame. The
height profile under the map walks the straight lines the autopilot will fly
and shows where they come closest to the ground. The ground data does not
include trees, buildings or wires.
