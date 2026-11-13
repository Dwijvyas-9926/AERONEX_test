import { ChevronDown, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  const open = useSettings((s) => s.navOpen);
  const { pathname } = useLocation();
  const current = ROUTES.find((r) => (r.path === "/" ? pathname === "/" : pathname.startsWith(r.path)))?.group ?? null;
  // Going to a page, by a link, search or the keyboard, opens the stage it belongs to.
  useEffect(() => {
    if (current && STAGES.some((s) => s.group === current)) set("navOpen", current);
  }, [current, set]);
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

      {/*
        The four stages of working on an aircraft, in the order they happen.
        Each opens to show its pages, one stage at a time, so the menu is a
        short list of where you are in the work and not every page at once.
      */}
      {STAGES.map((stage, i) => {
        const pages = ROUTES.filter((r) => r.group === stage.group);
        const isOpen = open === stage.group;
        const here = stage.group === current;
        return (
          <div className={`nav-group nav-stage${isOpen ? " open" : ""}${here ? " here" : ""}`} key={stage.group}>
            <button className="nav-group-label" aria-expanded={isOpen} aria-controls={`nav-${i}`} title={stage.summary} onClick={() => set("navOpen", isOpen ? null : stage.group)}>
              <span className="nav-step" aria-hidden>
                {i + 1}
              </span>
              <span className="nav-stage-name">{stage.group}</span>
              <ChevronDown className="nav-chevron" aria-hidden />
            </button>
            <div className="nav-items" id={`nav-${i}`}>
              <div className="nav-items-in">
                {pages.map((r) => (
                  <Item key={r.path} r={r} />
                ))}
              </div>
            </div>
          </div>
        );
      })}

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
