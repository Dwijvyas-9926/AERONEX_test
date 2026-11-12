import {
  Cable,
  CircleHelp,
  CornerDownLeft,
  PanelLeft,
  Search,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../app/routes";
import { useSettings } from "../../state/settingsStore";
import { useUi } from "../../state/uiStore";

interface Entry {
  id: string;
  label: string;
  detail: string;
  group: string;
  icon: LucideIcon;
  /** Everything the query is matched against, lower case. */
  hay: string;
  run: () => void;
}

/**
 * Jump to any page or action by typing a few letters of it.
 *
 * Eighteen pages is too many to hold in the head. This finds one by its name,
 * by what it does ("wobble" finds PID Tuning) or by a word a newcomer might
 * use for it ("settings" finds Parameters as well as Settings).
 */
export function SearchPalette() {
  const open = useUi((s) => s.overlay === "search");
  // Mounted afresh each time it opens, so it always starts empty.
  return <AnimatePresence>{open && <Palette />}</AnimatePresence>;
}

function Palette() {
  const close = useUi((s) => s.close);
  const openHelp = useUi((s) => s.open);
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = ROUTES.map((r) => ({
      id: r.path,
      label: r.label,
      detail: r.blurb,
      group: r.group === "Home" || r.group === "System" ? "Pages" : r.group,
      icon: r.icon,
      hay: `${r.label} ${r.blurb} ${r.find ?? ""} ${r.group}`.toLowerCase(),
      run: () => nav(r.path),
    }));
    const actions: Entry[] = [
      {
        id: "act-connect",
        label: "Connect aircraft",
        detail: "Open Connection and link a flight controller.",
        group: "Actions",
        icon: Cable,
        hay: "connect aircraft link usb radio pixhawk plug",
        run: () => nav("/connection"),
      },
      {
        id: "act-help",
        label: "Explain this page",
        detail: "Open the guide for the page you are on.",
        group: "Actions",
        icon: CircleHelp,
        hay: "help guide explain how what glossary meaning",
        run: () => openHelp("help"),
      },
      {
        id: "act-sidebar",
        label: "Collapse or expand the sidebar",
        detail: "Give the page more room.",
        group: "Actions",
        icon: PanelLeft,
        hay: "sidebar collapse expand menu navigation hide",
        run: () =>
          useSettings
            .getState()
            .set("sidebarCollapsed", !useSettings.getState().sidebarCollapsed),
      },
    ];
    return [...pages, ...actions];
  }, [nav, openHelp]);

  const results = useMemo(() => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return entries;
    return entries
      .filter((e) => words.every((w) => e.hay.includes(w)))
      .sort(
        (a, b) =>
          Number(b.label.toLowerCase().startsWith(words[0])) -
          Number(a.label.toLowerCase().startsWith(words[0])),
      );
  }, [q, entries]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${at}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const choose = (e: Entry | undefined) => {
    if (!e) return;
    close();
    e.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setAt((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAt((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[at]);
    }
  };

  return (
    <motion.div
      className="scrim palette-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={close}
    >
      <motion.div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Search pages and actions"
        initial={{ y: -8, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <label className="palette-field">
          <Search aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            placeholder="Where do you want to go?"
            aria-label="Search pages and actions"
            aria-controls="palette-list"
            aria-activedescendant={results[at] ? `pal-${at}` : undefined}
            role="combobox"
            aria-expanded="true"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd>Esc</kbd>
        </label>

        {results.length === 0 ? (
          <p className="palette-empty">
            Nothing matches &ldquo;{q}&rdquo;. Try a plainer word, such as{" "}
            <em>connect</em>, <em>motor</em> or <em>battery</em>.
          </p>
        ) : (
          <ul
            className="palette-list"
            id="palette-list"
            role="listbox"
            ref={listRef}
          >
            {results.map((e, i) => {
              const Icon = e.icon;
              const head = i === 0 || results[i - 1].group !== e.group;
              return (
                <li key={e.id} role="presentation">
                  {head && <div className="palette-group">{e.group}</div>}
                  <button
                    id={`pal-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={i === at}
                    className={`palette-item${i === at ? " on" : ""}`}
                    onMouseMove={() => setAt(i)}
                    onClick={() => choose(e)}
                    tabIndex={-1}
                  >
                    <Icon aria-hidden />
                    <span className="palette-text">
                      <strong>{e.label}</strong>
                      <span>{e.detail}</span>
                    </span>
                    {i === at && (
                      <CornerDownLeft className="palette-enter" aria-hidden />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </motion.div>
    </motion.div>
  );
}
