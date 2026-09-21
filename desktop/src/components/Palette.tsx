import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icons";
import type { Area } from "./AppShell";
import { pushToast } from "./ToastBus";

type Item = {
  id: string;
  label: string;
  hint?: string;
  kbd?: string;
  group: "Go to" | "Actions" | "Skills";
  icon?: React.ReactNode;
  action: () => void;
};

export function Palette({ onClose, onArea }: { onClose: () => void; onArea: (a: Area) => void }) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = [
      { id: "home", label: "Go to Home", kbd: "⌘1", group: "Go to", icon: <Icon.Home width={14} height={14}/>, action: () => onArea("home") },
      { id: "workbench", label: "Go to Workbench", kbd: "⌘2", group: "Go to", icon: <Icon.Code width={14} height={14}/>, action: () => onArea("workbench") },
      { id: "builder", label: "Go to Builder", kbd: "⌘3", group: "Go to", icon: <Icon.Bolt width={14} height={14}/>, action: () => onArea("builder") },
      { id: "projects", label: "Go to Projects", kbd: "⌘4", group: "Go to", icon: <Icon.Folder width={14} height={14}/>, action: () => onArea("projects") },
      { id: "research", label: "Go to Research", kbd: "⌘5", group: "Go to", icon: <Icon.Book width={14} height={14}/>, action: () => onArea("research") },
      { id: "agents", label: "Go to Agents", kbd: "⌘6", group: "Go to", icon: <Icon.Bot width={14} height={14}/>, action: () => onArea("agents") },
      { id: "trust", label: "Go to Trust Center", kbd: "⌘7", group: "Go to", icon: <Icon.Shield width={14} height={14}/>, action: () => onArea("trust") },
      { id: "voice", label: "Go to Voice", kbd: "⌘8", group: "Go to", icon: <Icon.Mic width={14} height={14}/>, action: () => onArea("voice") },
      { id: "settings", label: "Go to Settings", kbd: "⌘,", group: "Go to", icon: <Icon.Settings width={14} height={14}/>, action: () => onArea("settings") },
    ];
    const actions: Item[] = [
      { id: "new-task", label: "New task", kbd: "⌘N", group: "Actions", icon: <Icon.Plus width={14} height={14}/>, action: () => { onArea("workbench"); } },
      { id: "toggle-theme", label: "Toggle theme (dark/light)", group: "Actions", icon: <Icon.Sparkles width={14} height={14}/>, action: () => {
        const cur = document.documentElement.getAttribute("data-theme") || "dark";
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem("xr.theme", next);
        pushToast("ok", `Theme: ${next}`, "preference saved");
      }},
      { id: "stop-xr", label: "Stop XR", kbd: "⌘.", group: "Actions", icon: <Icon.Stop width={14} height={14}/>, action: () => pushToast("info", "Stop XR", "no active task") },
      { id: "toggle-chat", label: "Toggle XR chat panel", kbd: "⌘L", group: "Actions", icon: <Icon.PanelRight width={14} height={14}/>, action: () => pushToast("info", "Chat panel", "toggled") },
      { id: "toggle-terminal", label: "Toggle terminal", kbd: "⌘J", group: "Actions", icon: <Icon.Terminal width={14} height={14}/>, action: () => pushToast("info", "Terminal", "toggled") },
    ];
    const skills: Item[] = [
      { id: "s-code", label: "Skill: Edit code", group: "Skills", icon: <Icon.Code width={14} height={14}/>, action: () => { onArea("workbench"); } },
      { id: "s-research", label: "Skill: Academic research", group: "Skills", icon: <Icon.Book width={14} height={14}/>, action: () => { onArea("research"); } },
      { id: "s-build", label: "Skill: Build website", group: "Skills", icon: <Icon.Bolt width={14} height={14}/>, action: () => { onArea("builder"); } },
    ];
    const all = [...nav, ...actions, ...skills];
    if (!q.trim()) return all;
    const t = q.toLowerCase();
    return all.filter(i => i.label.toLowerCase().includes(t) || i.id.toLowerCase().includes(t));
  }, [q, onArea]);

  const groups = useMemo(() => {
    const g: Record<string, Item[]> = {};
    items.forEach(i => { (g[i.group] ||= []).push(i); });
    return g;
  }, [items]);

  const flat = items;
  useEffect(() => { setIdx(0); }, [q]);

  const run = (it: Item) => { it.action(); onClose(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); const it = flat[idx]; if (it) run(it); }
  };

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 0); }, []);

  // 0ms open (no animation) per spec — Raycast rule
  let cursor = 0;

  return (
    <div className="xr-palette-backdrop" onClick={onClose}>
      <div className="xr-palette" onClick={(e) => e.stopPropagation()}>
        <div style={{ position: "relative" }}>
          <Icon.Search width={18} height={18} className="search-ic"/>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search or run a command…"
          />
        </div>
        <div className="results">
          {flat.length === 0 && (
            <div style={{ padding: 20, textAlign: "center", color: "var(--xr-muted)", fontSize: 12.5 }}>
              No results for "{q}"
            </div>
          )}
          {Object.entries(groups).map(([gname, gitems]) => (
            <div key={gname}>
              <div className="group-label">{gname}</div>
              {gitems.map((it) => {
                const my = cursor++;
                const selected = my === idx;
                return (
                  <div key={it.id}
                    className="item"
                    aria-selected={selected}
                    onMouseEnter={() => setIdx(my)}
                    onClick={() => run(it)}>
                    <span style={{ color: "var(--xr-text-dim)", display: "inline-grid", placeItems: "center" }}>{it.icon ?? <Icon.Search width={14} height={14}/>}</span>
                    <span className="label">{it.label}</span>
                    {it.hint && <span className="hint">{it.hint}</span>}
                    {it.kbd && <span className="kbd"><span className="xr-keycap">{it.kbd}</span></span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <footer>
          <span><span className="xr-keycap">↑↓</span> navigate</span>
          <span><span className="xr-keycap">↵</span> run</span>
          <span><span className="xr-keycap">esc</span> close</span>
        </footer>
      </div>
    </div>
  );
}
