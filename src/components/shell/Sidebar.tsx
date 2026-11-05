import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { ROUTES, type RouteDef } from "../../app/routes";
import { useSettings } from "../../state/settingsStore";

const GROUPS: RouteDef["group"][] = ["Workspace", "Setup", "Tune & Configure", "Flight", "Analysis"];

function tag(r: RouteDef) {
  if (r.status.kind === "planned") return `Phase ${r.status.phase}`;
  return null;
}

function Item({ r }: { r: RouteDef }) {
  const Icon = r.icon;
  const t = tag(r);
  return (
    <NavLink to={r.path} end={r.path === "/"} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`} title={r.label}>
      <Icon aria-hidden />
      <span className="nav-label">{r.label}</span>
      {t && <span className="nav-tag">{t}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const set = useSettings((s) => s.set);
  const system = ROUTES.filter((r) => r.group === "System");
  return (
    <nav className="sidebar" aria-label="Modules">
      {GROUPS.map((g) => (
        <div className="nav-group" key={g}>
          <div className="nav-group-label">{g}</div>
          {ROUTES.filter((r) => r.group === g).map((r) => (
            <Item key={r.path} r={r} />
          ))}
        </div>
      ))}
      <div className="sidebar-foot">
        {system.map((r) => (
          <Item key={r.path} r={r} />
        ))}
        <button
          className="nav-item"
          style={{ width: "100%", border: 0, background: "transparent", cursor: "pointer", font: "inherit", textAlign: "left" }}
          onClick={() => set("sidebarCollapsed", !collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
          <span className="nav-label">Collapse</span>
        </button>
      </div>
    </nav>
  );
}
