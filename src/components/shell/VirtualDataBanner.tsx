import { FlaskConical } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { linkManager } from "../../services/link/linkManager";
import { isPortOpen, useLink } from "../../state/linkStore";

/*
  While the virtual aircraft is on the link, every page reads it exactly as it
  would read a Pixhawk. That is the point of it, but it must never be mistaken
  for hardware, so every page that shows aircraft data says so at the top.
*/

// Pages that never show link data, and the simulator, which is the source.
const QUIET = new Set(["/simulator", "/about", "/settings", "/frame-studio"]);

export function VirtualDataBanner() {
  const virtual = useLink((s) => s.virtual);
  const open = useLink((s) => isPortOpen(s.status));
  const { pathname } = useLocation();
  const nav = useNavigate();
  if (!virtual || !open || QUIET.has(pathname)) return null;
  return (
    <div className="virtual-banner" role="status">
      <FlaskConical aria-hidden className="vb-icon" />
      <p>
        <strong>Simulated data.</strong> Everything on this page comes from the built-in virtual aircraft, not a real flight controller. Nothing you do here reaches hardware.
      </p>
      <div className="vb-actions">
        <button className="btn btn-sm btn-ghost" onClick={() => nav("/simulator")}>
          Open simulator
        </button>
        <button className="btn btn-sm" onClick={() => void linkManager.disconnect("Virtual aircraft stopped.")}>
          Stop virtual aircraft
        </button>
      </div>
    </div>
  );
}
