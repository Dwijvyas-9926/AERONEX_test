import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sleep, tcpSerialPort, until } from "./harness";

/*
  The mission planner against real ArduCopter.

  Not a model of the firmware: the firmware. ArduPilot's own simulator build
  ("SITL") runs the same flight code as a Pixhawk. These tests connect the
  app to it through the app's real serial path and do what a user does: link,
  read the settings, send missions, read them back, and fly them, watching
  where the aircraft actually goes.

  Run with the path to the binary and to ArduPilot's default parameters:

      SITL_BIN=…/build/sitl/bin/arducopter SITL_DEFAULTS=…/Tools/autotest/default_params/copter.parm \
        npx vitest run sitl

  Without SITL_BIN these tests are skipped, so the ordinary test run does not
  need ArduPilot.
*/
const BIN = process.env.SITL_BIN;
const DEFAULTS = process.env.SITL_DEFAULTS;
const SPEEDUP = Number(process.env.SITL_SPEEDUP ?? 8);
const REPORT = process.env.SITL_REPORT;

// The app expects a browser. Give it the few things it touches.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
vi.stubGlobal("window", Object.assign(globalThis, { addEventListener: () => undefined, removeEventListener: () => undefined }));
Object.defineProperty(globalThis.navigator, "serial", { value: { addEventListener: () => undefined, getPorts: async () => [] }, configurable: true });

const HOME = { lat: 23.0225, lon: 72.5714, altMsl: 53 };
const report: string[] = [];
const say = (line: string) => {
  report.push(line);
  console.log(line);
};

describe.skipIf(!BIN)("the planner against real ArduCopter (SITL)", () => {
  let proc: ChildProcess;
  let app: {
    linkManager: (typeof import("../src/services/link/linkManager"))["linkManager"];
    commandLink: (typeof import("../src/services/link/commandLink"))["commandLink"];
    link: typeof import("../src/services/link/commandLink");
    useLink: (typeof import("../src/state/linkStore"))["useLink"];
    useParams: (typeof import("../src/state/paramStore"))["useParams"];
    sim: typeof import("../src/state/simStore");
    home: typeof import("../src/services/link/homeFollow");
    geo: typeof import("../src/geo/geo");
    fw: typeof import("../src/sim/firmwareParams");
    params: typeof import("../src/sim/params");
  };
  const tele = () => app.useLink.getState().telemetry;
  const pos = () => tele().position?.value;
  const armed = () => !!app.useLink.getState().vehicle?.armed;
  const texts: string[] = [];
  let radio = { loss: 0, dropped: 0 };

  beforeAll(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "aeronex-sitl-"));
    const args = ["--model", "quad", "--speedup", String(SPEEDUP), "--home", `${HOME.lat},${HOME.lon},${HOME.altMsl},0`, "-I0", "--wipe"];
    if (DEFAULTS) args.push("--defaults", DEFAULTS);
    proc = spawn(BIN!, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    proc.stdout!.on("data", (b) => (out += String(b)));
    proc.stderr!.on("data", (b) => (out += String(b)));
    await until("the simulator to listen", () => /bind port 5760|Waiting for connection/.test(out), 30000);

    app = {
      linkManager: (await import("../src/services/link/linkManager")).linkManager,
      commandLink: (await import("../src/services/link/commandLink")).commandLink,
      link: await import("../src/services/link/commandLink"),
      useLink: (await import("../src/state/linkStore")).useLink,
      useParams: (await import("../src/state/paramStore")).useParams,
      sim: await import("../src/state/simStore"),
      home: await import("../src/services/link/homeFollow"),
      geo: await import("../src/geo/geo"),
      fw: await import("../src/sim/firmwareParams"),
      params: await import("../src/sim/params"),
    };
    // The plan starts somewhere else entirely, as it would on a user's laptop.
    app.sim.useSim.setState({ home: { lat: 22.3, lon: 73.2, altMsl: 35 }, points: [], takeoffAlt: 10, ending: "rtl" });
    app.home.startHomeFollow();
    app.useLink.subscribe((s) => {
      for (const e of s.events) if (!texts.includes(e.text)) texts.push(e.text);
    });

    const wire = tcpSerialPort("127.0.0.1", 5760);
    radio = wire.link;
    const { serial } = wire;
    await app.linkManager.connect(serial);
    await until("a heartbeat from ArduCopter", () => app.useLink.getState().status === "connected", 30000);
  }, 90000);

  afterAll(async () => {
    try {
      await app?.linkManager.disconnect("Test finished.");
    } catch {
      /* closing */
    }
    proc?.kill("SIGKILL");
    if (REPORT) writeFileSync(REPORT, report.join("\n") + "\n");
  });

  it("links as it would to a Pixhawk and identifies the aircraft", () => {
    const v = app.useLink.getState().vehicle!;
    expect(v.sysid).toBeGreaterThan(0);
    say(`Linked: system ${v.sysid}, component ${v.compid}, ${JSON.stringify({ autopilot: (v as never as { autopilot?: unknown }).autopilot, type: (v as never as { type?: unknown }).type })}`);
  });

  it("reads every parameter, and finds all the ones it models under this firmware's names", async () => {
    await app.commandLink.requestAllParams();
    await until("the parameter download", () => {
      const p = app.useParams.getState();
      return p.count !== null && p.received >= p.count;
    }, 120000);
    const raw = app.useParams.getState().values;
    const named = app.fw.withOlderNames(raw);
    const missingRaw = app.params.PARAM_DEFS.filter((d) => !Number.isFinite(raw[d.name])).map((d) => d.name);
    const missing = app.params.PARAM_DEFS.filter((d) => !Number.isFinite(named[d.name])).map((d) => d.name);
    say(`Parameters: ${Object.keys(raw).length} read. Newer names in use: ${app.fw.usesNewerNames(raw)}.`);
    say(`Modelled names this firmware does not report as such: ${missingRaw.length ? missingRaw.join(", ") : "none"}`);
    say(`Still missing after translation: ${missing.length ? missing.join(", ") : "none"}`);
    say(`Return height: firmware RTL_ALT_M=${raw.RTL_ALT_M} RTL_ALT=${raw.RTL_ALT} -> app RTL_ALT=${named.RTL_ALT} cm. Cruise: WP_SPD=${raw.WP_SPD} WPNAV_SPEED=${raw.WPNAV_SPEED} -> ${named.WPNAV_SPEED} cm/s. Lean limit -> ${named.ANGLE_MAX} cdeg. Land speed -> ${named.LAND_SPEED} cm/s.`);
    expect(missing).toEqual([]);
    // The values must be in the units the app works in.
    expect(named.RTL_ALT).toBeGreaterThanOrEqual(0);
    expect(named.WPNAV_SPEED).toBeGreaterThan(100);
    expect(named.WPNAV_SPEED).toBeLessThan(3000);
    expect(named.ANGLE_MAX).toBeGreaterThanOrEqual(1000);
    expect(named.ANGLE_MAX).toBeLessThanOrEqual(8000);
    expect(named.LAND_SPEED).toBeGreaterThan(10);
    expect(named.LAND_SPEED).toBeLessThan(500);
  }, 150000);

  it("takes home from the aircraft's GPS, to within a few metres of where the aircraft is", async () => {
    await until("a 3D GPS fix", () => (tele().gps?.value.fixType ?? 0) >= 3, 120000);
    await until("home to follow the aircraft", () => app.home.useHomeSource.getState().source === "aircraft", 60000);
    await until("the aircraft's own HOME_POSITION", () => !!tele().home, 60000);
    await sleep(1500);
    const h = app.sim.useSim.getState().home;
    const off = app.geo.distanceM(h, HOME);
    say(`Home: app has ${h.lat.toFixed(6)}, ${h.lon.toFixed(6)}; simulator started at ${HOME.lat}, ${HOME.lon}; ${off.toFixed(1)} m apart. Aircraft reports HOME_POSITION ${JSON.stringify(tele().home?.value)}`);
    expect(off).toBeLessThan(5);
    expect(app.link.missionBlock()).toBeNull();
  }, 260000);

  const plans: { name: string; takeoff: number; ending: "rtl" | "land" | "hold"; pts: [number, number, number, number][] }[] = [
    { name: "three waypoints and a return", takeoff: 12, ending: "rtl", pts: [[60, 20, 20, 0], [70, -50, 30, 4], [-20, -40, 20, 0]] },
    { name: "one waypoint and a landing there", takeoff: 8, ending: "land", pts: [[40, 30, 15, 0]] },
    { name: "two waypoints and a hover", takeoff: 10, ending: "hold", pts: [[30, 0, 12, 0], [30, 30, 12, 2]] },
    { name: "sixty waypoints", takeoff: 15, ending: "rtl", pts: Array.from({ length: 60 }, (_, i) => [20 + i * 6, i % 2 ? 40 : -40, 20 + (i % 5) * 4, i % 7 === 0 ? 3 : 0] as [number, number, number, number]) },
    { name: "the height and wait limits", takeoff: 2, ending: "rtl", pts: [[100, 100, 500, 600], [-100, -100, 2, 0]] },
  ];
  const missionOf = (p: (typeof plans)[number]) => {
    const home = app.sim.useSim.getState().home;
    return app.sim.planToMission(home, p.takeoff, p.pts.map(([n, e, alt, holdS], i) => ({ id: `p${i}`, n, e, alt, holdS })), p.ending);
  };

  it("sends missions that ArduCopter accepts and reads them back identical", async () => {
    for (const p of plans) {
      const mission = missionOf(p);
      await app.commandLink.uploadMission(mission);
      const got = await app.commandLink.downloadMission();
      if (p === plans[0] || p === plans[1]) for (const [i, g] of got.entries()) say(`    item ${i}: sent cmd ${mission[i]?.command} frame ${mission[i]?.frame} p1 ${mission[i]?.p1} z ${mission[i]?.z} | holds cmd ${g.command} frame ${g.frame} p1 ${g.p1} x ${g.x} y ${g.y} z ${g.z}`);
      const differs = app.link.compareMissions(mission, got);
      // And back into a plan: what the planner shows must be what was drawn.
      const back = app.sim.missionToPlan(got, app.sim.useSim.getState().home);
      const same = back.points.length === p.pts.length && back.points.every((w, i) => Math.abs(w.n - p.pts[i][0]) <= 1 && Math.abs(w.e - p.pts[i][1]) <= 1 && Math.abs(w.alt - p.pts[i][2]) < 0.05 && w.holdS === p.pts[i][3]);
      say(`Mission "${p.name}": ${mission.length - 1} commands sent, ${got.length - 1} read back, ${differs ?? "identical"}; as a plan: ${same && back.ending === p.ending && back.takeoffAlt === p.takeoff ? "same plan" : "DIFFERENT"}${back.notes.length ? `; notes: ${back.notes.join(" ")}` : ""}`);
      expect(differs).toBeNull();
      expect(back.notes).toEqual([]);
      expect(same).toBe(true);
      expect(back.ending).toBe(p.ending);
      expect(back.takeoffAlt).toBe(p.takeoff);
    }
  }, 240000);

  it("refuses to send a mission while the GPS has no position, and sends nothing", async () => {
    const before = await app.commandLink.downloadMission();
    // The simulator's own switch for its GPS, which older releases named the other way round.
    const newer = Number.isFinite(app.useParams.getState().values.SIM_GPS1_ENABLE);
    const gps = (on: boolean) => (newer ? app.commandLink.setParam("SIM_GPS1_ENABLE", on ? 1 : 0) : app.commandLink.setParam("SIM_GPS_DISABLE", on ? 0 : 1));
    await gps(false);
    await until("the fix to be lost", () => (tele().gps?.value.fixType ?? 9) < 3, 60000);
    const block = app.link.missionBlock();
    say(`GPS switched off in the simulator: fix type ${tele().gps?.value.fixType}; the app says "${block?.title}"`);
    expect(block).not.toBeNull();
    await expect(app.commandLink.uploadMission(missionOf(plans[1]))).rejects.toThrow(/GPS/);
    await expect(app.commandLink.startMission()).rejects.toThrow(/GPS/);
    await gps(true);
    await until("the fix to return", () => (tele().gps?.value.fixType ?? 0) >= 3, 120000);
    await until("the block to lift", () => app.link.missionBlock() === null, 20000);
    // The mission on the aircraft is the one from before: nothing got through.
    const after = await app.commandLink.downloadMission();
    expect(app.link.compareMissions(before, after)).toBeNull();
  }, 300000);

  it("over a link that loses a fifth of everything, either sends the mission whole or says it failed", async () => {
    let ok = 0;
    let failed = 0;
    for (let round = 0; round < 6; round++) {
      const p = plans[round % 2 ? 3 : 0];
      const mission = missionOf(p);
      radio.loss = 0.2;
      let outcome: string;
      try {
        await app.commandLink.uploadMission(mission);
        const differs = await app.commandLink.verifyMission(mission);
        outcome = differs ? `sent, but the read-back caught a difference: ${differs}` : "sent and read back identical";
        if (!differs) ok++;
        else failed++;
      } catch (e) {
        outcome = `failed aloud: ${(e as Error).message.slice(0, 90)}`;
        failed++;
      }
      radio.loss = 0;
      await sleep(1500);
      // The truth, over a clean link: whatever the app reported must match what the aircraft holds.
      const truth = app.link.compareMissions(mission, await app.commandLink.downloadMission());
      say(`Lossy link, round ${round + 1} ("${p.name}"): ${outcome}; the aircraft in fact ${truth ? "does not hold it" : "holds it"}`);
      if (outcome === "sent and read back identical") expect(truth).toBeNull();
    }
    say(`Lossy link: ${ok} of 6 sent whole, ${failed} reported as failed, ${radio.dropped} chunks dropped. None was reported sent that was not.`);
    expect(ok + failed).toBe(6);
  }, 400000);

  /** Flies the mission now on the aircraft and returns where it went. */
  async function fly(p: (typeof plans)[number], during?: () => Promise<void>) {
    const home = app.sim.useSim.getState().home;
    const track: { n: number; e: number; alt: number; t: number }[] = [];
    const seen = new Set<number>();
    const stop = app.useLink.subscribe((s) => {
      const q = s.telemetry.position?.value;
      if (q) {
        const l = app.geo.toLocal(home, q.lat, q.lon);
        const last = track[track.length - 1];
        if (!last || last.n !== l.n || last.e !== l.e || last.alt !== q.relAlt) track.push({ n: l.n, e: l.e, alt: q.relAlt, t: Date.now() });
      }
      const m = s.telemetry.mission?.value as { seq?: number } | undefined;
      if (m && typeof m.seq === "number") seen.add(m.seq);
    });
    // Arming needs the position estimate to settle: try until ArduCopter agrees.
    await app.commandLink.setMode(4);
    let result = -1;
    for (let i = 0; i < 90 && result !== 0; i++) {
      result = await app.commandLink.arm(true).catch(() => -1);
      if (result !== 0) await sleep(1000);
    }
    expect(result, `ArduCopter would not arm. It said: ${texts.slice(-6).join(" | ")}`).toBe(0);
    const t0 = Date.now();
    expect(await app.commandLink.setMode(3)).toBe(0);
    expect(await app.commandLink.startMission()).toBe(0);
    if (during) {
      await until("the aircraft to climb", () => (pos()?.relAlt ?? 0) > 3, 60000);
      await during();
    }
    const limit = p.ending === "hold" ? 90000 : 600000;
    const end = Date.now() + limit;
    while (armed() && Date.now() < end) await sleep(200);
    const stillUp = armed();
    stop();
    const reach = p.pts.map(([n, e, alt]) => {
      let best = { d: Infinity, dz: 0 };
      for (const k of track) {
        const d = Math.hypot(k.n - n, k.e - e);
        if (d < best.d) best = { d, dz: k.alt - alt };
      }
      return best;
    });
    const last = track[track.length - 1];
    return { track, reach, last, stillUp, simSeconds: ((Date.now() - t0) / 1000) * SPEEDUP, maxAlt: Math.max(...track.map((k) => k.alt)), seen: [...seen].sort((a, b) => a - b) };
  }

  it("flies a mission it sent: every waypoint reached at its height, then home", async () => {
    // Let AUTO take off from the ground on a command, as the simulator page does for the virtual aircraft.
    await app.commandLink.setParam("AUTO_OPTIONS", 3);
    const p = plans[0];
    const mission = missionOf(p);
    await app.commandLink.uploadMission(mission);
    expect(await app.commandLink.verifyMission(mission)).toBeNull();
    let refused = "";
    const f = await fly(p, async () => {
      // In the air and armed: the app must not replace the mission.
      refused = await app.commandLink.uploadMission(missionOf(plans[1])).then(
        () => "ACCEPTED",
        (e: Error) => e.message,
      );
    });
    say(`Flight "${p.name}": ${f.track.length} positions over about ${Math.round(f.simSeconds)} s of flight. Mission items seen active: ${f.seen.join(", ")}.`);
    f.reach.forEach((r, i) => say(`  waypoint ${i + 1}: passed within ${r.d.toFixed(1)} m, ${r.dz >= 0 ? "+" : ""}${r.dz.toFixed(1)} m from its height of ${p.pts[i][2]} m`));
    say(`  highest ${f.maxAlt.toFixed(1)} m; ended ${Math.hypot(f.last.n, f.last.e).toFixed(1)} m from home at ${f.last.alt.toFixed(1)} m, ${f.stillUp ? "STILL ARMED" : "landed and disarmed"}`);
    say(`  sending a new mission while armed: ${refused}`);
    // The app's own prediction of this flight, on this aircraft's settings, beside what the firmware did.
    const { predict } = await import("../src/sim/predict");
    const { PRESETS } = await import("../src/sim/airframe");
    const { modelledParams } = await import("../src/sim/firmwareParams");
    const guess = predict(PRESETS[0], { ...app.params.defaultParams(PRESETS[0]), ...modelledParams(app.useParams.getState().values) }, app.sim.useSim.getState().home, mission, { windSpeed: 0, windFromDeg: 0, gust: 0, soc: 1, faults: [] });
    say(`  the app predicted "${guess.verdict}" in ${Math.round(guess.stats.durationS)} s; ArduCopter took about ${Math.round(f.simSeconds)} s`);
    expect(guess.verdict).toBe("completed");
    expect(refused).toMatch(/Disarm before changing the mission/);
    for (const r of f.reach) {
      expect(r.d).toBeLessThan(3.5);
      expect(Math.abs(r.dz)).toBeLessThan(2.5);
    }
    expect(f.stillUp).toBe(false);
    expect(Math.hypot(f.last.n, f.last.e)).toBeLessThan(4);
    expect(f.last.alt).toBeLessThan(1.5);
    expect(f.maxAlt).toBeLessThan(Math.max(...p.pts.map((w) => w[2])) + 4);
    // The mission on the aircraft is still the one that was flown.
    expect(app.link.compareMissions(mission, await app.commandLink.downloadMission())).toBeNull();
  }, 900000);

  it("flies the same mission in a 9 m/s wind and still reaches every waypoint", async () => {
    await app.commandLink.setParam("SIM_WIND_SPD", 9);
    await app.commandLink.setParam("SIM_WIND_DIR", 250);
    const p = plans[0];
    const mission = missionOf(p);
    await app.commandLink.uploadMission(mission);
    const f = await fly(p);
    await app.commandLink.setParam("SIM_WIND_SPD", 0);
    say(`Flight in a 9 m/s wind: ${f.reach.map((r, i) => `waypoint ${i + 1} within ${r.d.toFixed(1)} m (${r.dz >= 0 ? "+" : ""}${r.dz.toFixed(1)} m)`).join(", ")}; landed ${Math.hypot(f.last.n, f.last.e).toFixed(1)} m from home, ${f.stillUp ? "STILL ARMED" : "disarmed"}, about ${Math.round(f.simSeconds)} s`);
    for (const r of f.reach) {
      expect(r.d).toBeLessThan(4);
      expect(Math.abs(r.dz)).toBeLessThan(2.5);
    }
    expect(f.stillUp).toBe(false);
    expect(Math.hypot(f.last.n, f.last.e)).toBeLessThan(5);
  }, 900000);

  it("flies a mission that ends with a landing away from home", async () => {
    const p = plans[1];
    const mission = missionOf(p);
    await app.commandLink.uploadMission(mission);
    expect(await app.commandLink.verifyMission(mission)).toBeNull();
    const f = await fly(p);
    const [n, e] = p.pts[0];
    say(`Flight "${p.name}": waypoint passed within ${f.reach[0].d.toFixed(1)} m; landed ${Math.hypot(f.last.n - n, f.last.e - e).toFixed(1)} m from it, ${Math.hypot(f.last.n, f.last.e).toFixed(1)} m from home, ${f.stillUp ? "STILL ARMED" : "disarmed"}`);
    expect(f.reach[0].d).toBeLessThan(3.5);
    expect(f.stillUp).toBe(false);
    expect(Math.hypot(f.last.n - n, f.last.e - e)).toBeLessThan(4);
    expect(f.last.alt).toBeLessThan(1.5);
  }, 900000);

  it("holds at the last waypoint when the mission ends with a hover, and comes down when told", async () => {
    const p = plans[2];
    const mission = missionOf(p);
    await app.commandLink.uploadMission(mission);
    const f = await fly(p);
    const [n, e, alt] = p.pts[p.pts.length - 1];
    say(`Flight "${p.name}": after the last waypoint it is ${Math.hypot(f.last.n - n, f.last.e - e).toFixed(1)} m from it at ${f.last.alt.toFixed(1)} m (planned ${alt} m), ${f.stillUp ? "still flying, as planned" : "DISARMED"}; mode ${app.useLink.getState().vehicle?.mode ?? "?"}`);
    expect(f.stillUp).toBe(true);
    expect(Math.hypot(f.last.n - n, f.last.e - e)).toBeLessThan(4);
    expect(Math.abs(f.last.alt - alt)).toBeLessThan(2.5);
    // Bring it home: the Return command the app sends.
    expect(await app.commandLink.setMode(6)).toBe(0);
    await until("it to land and disarm", () => !armed(), 300000);
    const q = pos()!;
    const l = app.geo.toLocal(app.sim.useSim.getState().home, q.lat, q.lon);
    say(`  Return: landed ${Math.hypot(l.n, l.e).toFixed(1)} m from home`);
    expect(Math.hypot(l.n, l.e)).toBeLessThan(4);
  }, 900000);
});
