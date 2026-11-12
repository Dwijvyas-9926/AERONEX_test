import { Cable, Gamepad2, type LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export interface ConnectPromptItem {
  icon: LucideIcon;
  title: string;
  detail: string;
}

/**
 * What a live page shows before there is anything live to show.
 *
 * These pages used to open on a title, one grey sentence and an otherwise
 * empty screen — which is the first thing every new user sees on most of the
 * app, since nobody starts with an aircraft connected. An empty page is the
 * place to say what will be here and what to do about it, so this says both:
 * what the page reads from the aircraft once it is linked, and the one action
 * that gets there. The simulator is offered beside it because, for someone
 * without hardware on the bench, that is the honest next step rather than a
 * dead end.
 *
 * The flat trace is the link itself: a MAVLink connection is a heartbeat, and
 * until one arrives there is nothing to draw.
 */
export function ConnectPrompt({
  title,
  children,
  items,
  simulator = true,
}: {
  title: string;
  children: React.ReactNode;
  items: ConnectPromptItem[];
  /** Offer the simulator as the alternative. Off where it is not one. */
  simulator?: boolean;
}) {
  return (
    <section className="connect-prompt" aria-label="No aircraft connected">
      <div className="connect-prompt-main">
        <svg className="connect-trace" viewBox="0 0 320 40" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 20 H118 l6 -3 l5 3 H320" />
          <circle cx="124" cy="17" r="2.5" />
        </svg>
        <p className="connect-trace-label">No heartbeat</p>
        <h2>{title}</h2>
        <p className="connect-prompt-body">{children}</p>
        <div className="connect-prompt-actions">
          <Link className="btn btn-primary" to="/connection">
            <Cable /> Connect aircraft
          </Link>
          {simulator && (
            <Link className="btn btn-ghost" to="/simulator">
              <Gamepad2 /> Use the virtual aircraft
            </Link>
          )}
        </div>
      </div>
      <div className="connect-prompt-list">
        <h3>Once it is linked, this page shows</h3>
        <ul>
          {items.map((item) => (
            <li key={item.title}>
              <item.icon aria-hidden="true" />
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
