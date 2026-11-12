import { BookOpen, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { guideFor } from "../../app/guide";
import { ROUTES, routeFor } from "../../app/routes";
import { useUi } from "../../state/uiStore";

/**
 * The guide to the page you are on.
 *
 * Every page answers the same four questions in the same order — what it is
 * for, what it needs, what to do, what the words mean — so someone who has
 * read one knows where to look in the next. It slides in beside the page
 * rather than over it: the point is to read a step and then do it.
 */
export function HelpPanel() {
  const open = useUi((s) => s.overlay === "help");
  const close = useUi((s) => s.close);
  const { pathname } = useLocation();
  const route = routeFor(pathname);
  const guide = guideFor(route.path);
  const closeRef = useRef<HTMLButtonElement>(null);
  const Icon = route.icon;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, close]);

  // What usually comes next: the page after this one in the same journey.
  const i = ROUTES.findIndex((r) => r.path === route.path);
  const next = ROUTES.slice(i + 1).find((r) => r.group !== "System" && r.status.kind !== "planned");

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          className="help"
          role="complementary"
          aria-labelledby="help-title"
          initial={{ x: 28, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 28, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <header className="help-head">
            <span className="help-icon">
              <Icon aria-hidden />
            </span>
            <div>
              <p className="help-kicker">Guide</p>
              <h2 id="help-title">{route.label}</h2>
            </div>
            <button ref={closeRef} className="icon-btn" onClick={close} aria-label="Close the guide">
              <X />
            </button>
          </header>

          <div className="help-body">
            <p className="help-purpose">{guide.purpose}</p>

            {guide.needs.length > 0 && (
              <section>
                <h3>Before you start</h3>
                <ul className="help-needs">
                  {guide.needs.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <h3>How to use it</h3>
              <ol className="help-steps">
                {guide.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </section>

            {guide.terms.length > 0 && (
              <section>
                <h3>Words on this page</h3>
                <dl className="help-terms">
                  {guide.terms.map(([term, meaning]) => (
                    <div key={term}>
                      <dt>{term}</dt>
                      <dd>{meaning}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </div>

          <footer className="help-foot">
            {next && (
              <Link to={next.path} className="help-next" onClick={close}>
                <span>Usually next</span>
                <strong>{next.label}</strong>
              </Link>
            )}
            <Link to="/about" className="help-all" onClick={close}>
              <BookOpen aria-hidden /> The whole workflow
            </Link>
          </footer>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
