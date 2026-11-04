import { create } from "zustand";

/*
  Cache of autopilot parameters (ArduPilot style). PARAM_VALUE messages from the
  vehicle populate `values`; a PARAM_SET we send is tracked in `pending` until
  the vehicle echoes the new value back (its acknowledgement), at which point the
  pending entry clears. Nothing here writes to the vehicle — commandLink does the
  I/O and calls these setters.
*/

export type ParamWriteState = "ok" | "writing" | "failed";

export interface PendingWrite {
  target: number;
  at: number;
  state: ParamWriteState;
}

interface ParamStoreState {
  values: Record<string, number>;
  pending: Record<string, PendingWrite>;
  count: number | null; // param_count the vehicle reports
  received: number; // distinct params seen (download progress)
  lastUpdateAt: number | null;
  reset: () => void;
  onParamValue: (id: string, value: number, count: number) => void;
  markPending: (id: string, target: number) => void;
  markFailed: (id: string) => void;
}

export const useParams = create<ParamStoreState>((set, get) => ({
  values: {},
  pending: {},
  count: null,
  received: 0,
  lastUpdateAt: null,
  reset: () => set({ values: {}, pending: {}, count: null, received: 0, lastUpdateAt: null }),
  onParamValue: (id, value, count) => {
    const s = get();
    const wasKnown = id in s.values;
    const pending = { ...s.pending };
    // A matching pending write is now confirmed by the vehicle's echo.
    if (pending[id] && Math.abs(pending[id].target - value) < 1e-4) delete pending[id];
    set({
      values: { ...s.values, [id]: value },
      pending,
      count: count || s.count,
      received: wasKnown ? s.received : s.received + 1,
      lastUpdateAt: Date.now(),
    });
  },
  markPending: (id, target) => set((s) => ({ pending: { ...s.pending, [id]: { target, at: Date.now(), state: "writing" } } })),
  markFailed: (id) =>
    set((s) => (s.pending[id] ? { pending: { ...s.pending, [id]: { ...s.pending[id], state: "failed" } } } : s)),
}));

/** Read a cached parameter, or undefined if the vehicle hasn't sent it. */
export const getParam = (name: string): number | undefined => useParams.getState().values[name];
