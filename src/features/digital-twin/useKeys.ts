import { useEffect, useRef } from "react";
import { noKeys, type Keys } from "./testFlight";

/*
  Tracks keys for manual flight while `active`. Returns a ref (no re-renders).
  Keys are virtual simulator controls; they never touch a connected aircraft.
*/
const MAP: Record<string, keyof Keys> = {
  KeyW: "pitchFwd",
  KeyS: "pitchBack",
  KeyA: "rollLeft",
  KeyD: "rollRight",
  KeyQ: "yawLeft",
  KeyE: "yawRight",
  ShiftLeft: "up",
  ShiftRight: "up",
  Space: "up",
  ControlLeft: "down",
  ControlRight: "down",
};

export function useKeys(active: boolean) {
  const keys = useRef<Keys>(noKeys());
  useEffect(() => {
    keys.current = noKeys();
    if (!active) return;
    const set = (code: string, v: boolean) => {
      const k = MAP[code];
      if (k) keys.current[k] = v;
    };
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (MAP[e.code]) e.preventDefault();
      set(e.code, true);
    };
    const up = (e: KeyboardEvent) => set(e.code, false);
    const blur = () => (keys.current = noKeys());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [active]);
  return keys;
}
