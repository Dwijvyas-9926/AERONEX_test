import { CircleDot } from "lucide-react";
import type { ReactNode } from "react";

export interface PlannedItem {
  title: string;
  detail: string;
}

/** Honest placeholder: says what the module will do, in which phase, and what works today. */
export function PhaseBanner({ phase, title, children }: { phase: number; title: string; children: ReactNode }) {
  return (
    <div className="phase-banner">
      <span className="pill idle plain">Phase {phase}</span>
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function PlanList({ items, heading = "What this module will do" }: { items: PlannedItem[]; heading?: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{heading}</h3>
      </div>
      <ul className="plan-list" style={{ padding: "0 var(--s5)" }}>
        {items.map((i) => (
          <li key={i.title}>
            <CircleDot />
            <div>
              <strong>{i.title}</strong>
              <p>{i.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
