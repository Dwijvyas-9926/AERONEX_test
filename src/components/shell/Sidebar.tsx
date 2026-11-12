import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { NavLink } from "react-router-dom";
import { ROUTES, STAGES, type RouteDef } from "../../app/routes";
import { useSettings } from "../../state/settingsStore";
import { useUi } from "../../state/uiStore";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function Item({ r }: { r: RouteDef }) {
  const Icon = r.icon;
  const planned = r.status.kind === "planned";
  return (
    <NavLink
      to={r.path}
      end={r.path === "/"}
      className={({ isActive }) => `nav-item${isActive ? " active" : ""}${planned ? " planned" : ""}`}
      title={`${r.label} — ${r.blurb}`}
    >
      <Icon aria-hidden />
      <span className="nav-label">{r.label}</span>
      {planned && <span className="nav-tag">Soon</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  const set = useSettings((s) => s.set);
  const openSearch = useUi((s) => s.open);
  const home = ROUTES.filter((r) => r.group === "Home");
  const system = ROUTES.filter((r) => r.group === "System");
  return (
    <nav className="sidebar" aria-label="Pages">
      <button className="nav-search" onClick={() => openSearch("search")} title="Search pages and actions">
        <Search aria-hidden />
        <span className="nav-label">Search</span>
        <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>

      <div className="nav-group">
        {home.map((r) => (
          <Item key={r.path} r={r} />
        ))}
      </div>

      {/* The four stages of working on an aircraft, in the order they happen. */}
      {STAGES.map((stage, i) => (
        <div className="nav-group" key={stage.group}>
          <div className="nav-group-label" title={stage.summary}>
            <span className="nav-step" aria-hidden>
              {i + 1}
            </span>
            {stage.group}
          </div>
          {ROUTES.filter((r) => r.group === stage.group).map((r) => (
            <Item key={r.path} r={r} />
          ))}
        </div>
      ))}

      <div className="sidebar-foot">
        {system.map((r) => (
          <Item key={r.path} r={r} />
        ))}
        <button
          className="nav-item nav-collapse"
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
