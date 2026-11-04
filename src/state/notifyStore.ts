import { create } from "zustand";

export type Tone = "info" | "success" | "warn" | "error";

export interface Toast {
  id: number;
  tone: Tone;
  title: string;
  body?: string;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  resolve: (ok: boolean) => void;
}

interface NotifyState {
  toasts: Toast[];
  history: (Toast & { at: number })[];
  confirm: ConfirmRequest | null;
  dismiss: (id: number) => void;
  clearHistory: () => void;
}

let seq = 0;

export const useNotify = create<NotifyState>((set) => ({
  toasts: [],
  history: [],
  confirm: null,
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearHistory: () => set({ history: [] }),
}));

export function notify(tone: Tone, title: string, body?: string) {
  const t: Toast = { id: ++seq, tone, title, body };
  useNotify.setState((s) => ({
    toasts: [...s.toasts, t].slice(-4),
    history: [{ ...t, at: Date.now() }, ...s.history].slice(0, 50),
  }));
  const ttl = tone === "error" ? 9000 : tone === "warn" ? 7000 : 4500;
  window.setTimeout(() => useNotify.getState().dismiss(t.id), ttl);
}

/** Ask the user to confirm a consequential action. Resolves false on cancel. */
export function confirmAction(req: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useNotify.setState({
      confirm: {
        ...req,
        resolve: (ok) => {
          useNotify.setState({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}
