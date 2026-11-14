import { beforeEach, describe, expect, it, vi } from "vitest";

/* API keys stay out of long-lived storage unless the user asks otherwise. */

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

let local: Storage;
let session: Storage;
beforeEach(() => {
  vi.resetModules();
  local = memStorage();
  session = memStorage();
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", session);
});

describe("where keys are kept", () => {
  it("keeps a key for the session only, by default, apart from the ordinary settings", async () => {
    const { secretSplitStorage } = await import("../secretStorage");
    const st = secretSplitStorage(["aiKey"]);
    st.setItem("s", JSON.stringify({ state: { aiKey: "sk-ant-1", units: "metric" }, version: 2 }));
    expect(local.getItem("s")).not.toContain("sk-ant-1");
    expect(local.getItem("s.secret")).toBeNull();
    expect(session.getItem("s.secret")).toContain("sk-ant-1");
    expect(JSON.parse(st.getItem("s") as string).state).toEqual({ aiKey: "sk-ant-1", units: "metric" });
  });

  it("remembers keys on the device only when asked, and moves them when the choice changes", async () => {
    const mod = await import("../secretStorage");
    const st = mod.secretSplitStorage(["aiKey"]);
    const resave = vi.fn(() => st.setItem("s", st.getItem("s") as string));
    mod.onRememberChange(resave);
    st.setItem("s", JSON.stringify({ state: { aiKey: "k" }, version: 1 }));
    mod.setRememberKeys(true);
    expect(resave).toHaveBeenCalled();
    expect(local.getItem("s.secret")).toContain("k");
    expect(session.getItem("s.secret")).toBeNull();
    mod.setRememberKeys(false);
    expect(local.getItem("s.secret")).toBeNull();
    expect(session.getItem("s.secret")).toContain("k");
  });

  it("moves a key an older version left in the open settings", async () => {
    const { secretSplitStorage } = await import("../secretStorage");
    local.setItem("s", JSON.stringify({ state: { aiKey: "old-key", units: "metric" }, version: 2 }));
    const st = secretSplitStorage(["aiKey"]);
    expect(JSON.parse(st.getItem("s") as string).state.aiKey).toBe("old-key");
    expect(local.getItem("s")).not.toContain("old-key");
    expect(session.getItem("s.secret")).toContain("old-key");
  });

  it("reset removes everything the app keeps, and nothing else", async () => {
    vi.stubGlobal("window", { addEventListener: () => {} });
    const { resetAppData } = await import("../resetApp");
    for (const k of ["avion.profiles.v1", "avion.settings.v1", "avion.frame-studio.v1", "aeronex.sim.v1", "aeronex.map.v1", "aeronex.map.v1.secret", "aeronex.lastAircraftParams.v1", "aeronex.keys.remember", "someone-else"]) local.setItem(k, "x");
    session.setItem("avion.settings.v1.secret", "x");
    await resetAppData();
    expect(local.length).toBe(1);
    expect(local.getItem("someone-else")).toBe("x");
    expect(session.length).toBe(0);
  });
});
