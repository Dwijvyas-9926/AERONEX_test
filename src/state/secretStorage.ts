import type { StateStorage } from "zustand/middleware";

/*
  Where API keys are kept.

  The Anthropic key for Ask the Doctor and the map provider keys are the
  user's own credentials. Kept in localStorage they stay on the disk after
  the browser closes, readable by any script that ever runs on this origin.
  So by default they live in sessionStorage: for this tab, until it closes.
  The user can choose to have them remembered on this device; that choice is
  one flag for every key, and changing it moves the keys at once.

  A store using this keeps its ordinary settings in localStorage as before,
  under its own name, and its secret fields separately under `<name>.secret`
  in whichever storage the flag picks.
*/

const FLAG = "aeronex.keys.remember";
const SECRET = (name: string) => `${name}.secret`;

function safe<T>(f: () => T, fallback: T): T {
  try {
    return f();
  } catch {
    return fallback;
  }
}

/** True when keys are to be kept on this device across browser sessions. */
export const rememberKeys = () => safe(() => localStorage.getItem(FLAG) === "1", false);

const resavers: (() => void)[] = [];

/** Choose whether keys are remembered on this device; moves the keys already entered. */
export function setRememberKeys(on: boolean) {
  safe(() => (on ? localStorage.setItem(FLAG, "1") : localStorage.removeItem(FLAG)), undefined);
  for (const r of resavers) r();
}

/** Called by a store so that changing the flag re-saves it to the right place. */
export function onRememberChange(resave: () => void) {
  resavers.push(resave);
}

/** A zustand StateStorage that keeps `fields` of the state apart, per the flag above. */
export function secretSplitStorage(fields: string[]): StateStorage {
  const target = () => (rememberKeys() ? localStorage : sessionStorage);
  const other = () => (rememberKeys() ? sessionStorage : localStorage);
  const write = (name: string, value: string) => {
    const obj = JSON.parse(value) as { state?: Record<string, unknown>; version?: number };
    const secrets: Record<string, unknown> = {};
    if (obj.state) {
      for (const f of fields) {
        if (f in obj.state) secrets[f] = obj.state[f];
        delete obj.state[f];
      }
    }
    localStorage.setItem(name, JSON.stringify(obj));
    target().setItem(SECRET(name), JSON.stringify(secrets));
    other().removeItem(SECRET(name));
  };
  return {
    getItem: (name) =>
      safe(() => {
        const pub = localStorage.getItem(name);
        if (pub == null) return null;
        const obj = JSON.parse(pub) as { state?: Record<string, unknown> };
        const legacy = !!obj.state && fields.some((f) => f in obj.state!);
        const raw = target().getItem(SECRET(name)) ?? other().getItem(SECRET(name));
        const secrets = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        obj.state = { ...obj.state, ...secrets };
        const merged = JSON.stringify(obj);
        // A key saved by an older version sat in the open settings: move it now, not at the next change.
        if (legacy || (raw && !target().getItem(SECRET(name)))) write(name, merged);
        return merged;
      }, null),
    setItem: (name, value) => safe(() => write(name, value), undefined),
    removeItem: (name) =>
      safe(() => {
        localStorage.removeItem(name);
        localStorage.removeItem(SECRET(name));
        sessionStorage.removeItem(SECRET(name));
      }, undefined),
  };
}
