import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useNotify, type Tone } from "../../state/notifyStore";

const ICON: Record<Tone, typeof Info> = { info: Info, success: CircleCheck, warn: TriangleAlert, error: CircleAlert };

export function Toasts() {
  const toasts = useNotify((s) => s.toasts);
  const dismiss = useNotify((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.tone];
          return (
            <motion.div
              key={t.id}
              className={`toast ${t.tone}`}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <Icon />
              {t.action ? (
                <button
                  className="toast-go"
                  onClick={() => {
                    t.action?.run();
                    dismiss(t.id);
                  }}
                >
                  <strong>{t.title}</strong>
                  {t.body && <p>{t.body}</p>}
                  <span className="toast-link">{t.action.label}</span>
                </button>
              ) : (
                <div>
                  <strong>{t.title}</strong>
                  {t.body && <p>{t.body}</p>}
                </div>
              )}
              <button className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss">
                <X />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export function ConfirmDialog() {
  const req = useNotify((s) => s.confirm);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!req) return;
    cancelRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && req.resolve(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [req]);
  return (
    <AnimatePresence>
      {req && (
        <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => req.resolve(false)}>
          <motion.div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ y: 10, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="confirm-title">{req.title}</h2>
            <p>{req.body}</p>
            <div className="actions">
              <button ref={cancelRef} className="btn" onClick={() => req.resolve(false)}>
                Cancel
              </button>
              <button className={`btn ${req.tone === "danger" ? "btn-danger" : "btn-primary"}`} onClick={() => req.resolve(true)}>
                {req.confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
