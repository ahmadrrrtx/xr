import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { StatusDot } from "./StatusDot";

export type Area =
  | "home"
  | "workbench"
  | "builder"
  | "projects"
  | "research"
  | "agents"
  | "trust"
  | "voice"
  | "settings"
  | "memory"
  | "models"
  | "control"
  | "runs"
  | "diagnostics"
  | "library";

type NavItem = { id: Area; label: string; icon: ReactNode; shortcut: string; badge?: number };

export interface AppShellProps {
  area: Area;
  onArea: (a: Area) => void;
  engineVersion: string | null;
  onSearch: (q: string) => void;
  onOpenRun: (id: string) => void;
  voiceState: string;
  onVoiceOpen: () => void;
  onCheatSheet: () => void;
  onRefresh: () => void;
  onOpenPalette: () => void;
  onToggleChat?: () => void;
  onToggleTerminal?: () => void;
  onToggleExplorer?: () => void;
  children: ReactNode;
  providerState?: { name: string; kind: "ok" | "warn" | "err" | "info" | "idle" | "working"; label?: string };
  projectName?: string;
  approvalCount?: number;
  isHome?: boolean;
  isFullWidth?: boolean;
}

export function AppShell(props: AppShellProps) {
  const {
    area, onArea, engineVersion, onOpenPalette, onCheatSheet, voiceState,
    onToggleChat, onToggleTerminal, onToggleExplorer, children,
    providerState, projectName = "xr", approvalCount = 0,
  } = props;

  // Panel visibility is owned by the screen (e.g. Workbench sets classes on xr-body).
  // We keep chatOpen/explorerOpen state here only because ⌘L/⌘B may fire from non-workbench areas
  // and need to move the user into Workbench.
  const [chatOpen] = useState(true);
  const [explorerOpen] = useState(true);

  // ⌘K → palette; ⌘L → toggle chat; ⌘B → toggle explorer; ⌘J → toggle terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); onOpenPalette(); }
      else if (e.key === "?" && !isTyping(e.target as HTMLElement)) { e.preventDefault(); onCheatSheet(); }
      else if (meta && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (area !== "workbench" && area !== "builder") onArea("workbench");
        onToggleChat?.();
      }
      else if (meta && e.key.toLowerCase() === "b") { e.preventDefault(); onToggleExplorer?.(); }
      else if (meta && e.key.toLowerCase() === "j") { e.preventDefault(); onToggleTerminal?.(); }
      else if (meta && e.key >= "1" && e.key <= "8") {
        const idx = parseInt(e.key, 10) - 1;
        const items: Area[] = ["home", "workbench", "builder", "projects", "research", "agents", "trust", "voice"];
        if (items[idx]) { e.preventDefault(); onArea(items[idx]); }
      } else if (meta && e.key === ",") {
        e.preventDefault(); onArea("settings");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onOpenPalette, onCheatSheet, onToggleChat, onToggleTerminal, onToggleExplorer, onArea, area]);

  const navTop: NavItem[] = [
    { id: "home", label: "Home", icon: <Icon.Home width={20} height={20}/>, shortcut: "⌘1" },
    { id: "workbench", label: "Workbench", icon: <Icon.Code width={20} height={20}/>, shortcut: "⌘2" },
    { id: "builder", label: "Builder", icon: <Icon.Bolt width={20} height={20}/>, shortcut: "⌘3" },
    { id: "projects", label: "Projects", icon: <Icon.Folder width={20} height={20}/>, shortcut: "⌘4" },
    { id: "research", label: "Research", icon: <Icon.Book width={20} height={20}/>, shortcut: "⌘5" },
    { id: "agents", label: "Agents", icon: <Icon.Bot width={20} height={20}/>, shortcut: "⌘6" },
    { id: "trust", label: "Trust", icon: <Icon.Shield width={20} height={20}/>, shortcut: "⌘7", badge: approvalCount || undefined },
    { id: "voice", label: "Voice", icon: <Icon.Mic width={20} height={20}/>, shortcut: "⌘8" },
  ];

  const engStatus: "ok" | "warn" | "err" | "idle" | "working" = engineVersion ? "ok" : "err";
  const prov = providerState ?? { name: "connect a model", kind: "idle" as const };
  const isChrome = area === "workbench" || area === "builder";

  return (
    <div className="xr-app">
      {/* Title bar */}
      <div className="xr-titlebar">
        <div className="traffic">
          <span className="close"/>
          <span className="min"/>
          <span className="max"/>
        </div>
        <div className="brand" onClick={() => onArea("home")} style={{ cursor: "pointer" }}>
          <img src="/src/assets/xr-logo.png" alt="XR" style={{ width: 22, height: 22, objectFit: "contain", filter: "drop-shadow(0 0 10px rgba(0,212,255,0.45))" }}/>
          <span>XR</span>
        </div>
        {isChrome && (
          <>
            <div className="project" title="Current project">
              <Icon.Folder width={14} height={14}/>
              <b>{projectName}</b>
            </div>
          </>
        )}
        <div className="title-center" onClick={onOpenPalette} style={{ cursor: "pointer" }}>
          <div className="quick-search">
            <Icon.Search width={14} height={14}/>
            <span>Search or ask XR…</span>
            <span className="kbd xr-keycap">⌘K</span>
          </div>
        </div>
        <div className="title-right">
          <button className="xr-btn xr-btn--icon" onClick={onOpenPalette} title="Command Palette (⌘K)">
            <Icon.Search width={16} height={16}/>
          </button>
          <button className="xr-btn xr-btn--icon" onClick={onCheatSheet} title="Keyboard shortcuts (?)">
            <Icon.Help width={16} height={16}/>
          </button>
        </div>
      </div>

      {/* Rail */}
      <div className="xr-rail">
        <div className="rail-top">
          {navTop.map((it) => (
            <button
              key={it.id}
              className="rail-btn"
              aria-current={area === it.id ? "page" : undefined}
              onClick={() => onArea(it.id)}
              title={`${it.label} (${it.shortcut})`}
            >
              {it.icon}
              {it.badge ? <span className="badge">{it.badge}</span> : null}
            </button>
          ))}
        </div>
        <div className="rail-spacer"/>
        <div className="rail-bottom">
          <button className="rail-btn" onClick={() => onArea("runs")} aria-current={area === "runs" ? "page" : undefined} title="Runs history">
            <Icon.History width={20} height={20}/>
          </button>
          <button className="rail-btn" onClick={() => onArea("diagnostics")} aria-current={area === "diagnostics" ? "page" : undefined} title="Diagnostics">
            <Icon.Activity width={20} height={20}/>
          </button>
          <button className="rail-btn" onClick={() => onArea("settings")} aria-current={area === "settings" ? "page" : undefined} title="Settings (⌘,)">
            <Icon.Settings width={20} height={20}/>
          </button>
          <button className="rail-btn" title="Profile">
            <img src="/src/assets/xr-avatar.png" alt="Profile" style={{ width: 22, height: 22, borderRadius: "var(--xr-radius-md)", objectFit: "cover" }}/>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={`xr-body ${props.isFullWidth ? "xr-body-full" : ""} ${!chatOpen && isChrome ? "no-chat" : ""} ${!explorerOpen && isChrome ? "no-explorer" : ""}`}>
        {children}
      </div>

      {/* Status bar */}
      <div className="xr-statusbar">
        <span className="item" title="Engine status">
          <StatusDot kind={engStatus} size={8}/>
          {engineVersion ? `Ready` : `Offline`}
          {engineVersion ? <span className="sep">·</span> : null}
          {engineVersion ? <span className="xr-truncate">{engineVersion}</span> : null}
        </span>
        <span className="item" title="Active provider">
          <StatusDot kind={prov.kind as "ok" | "warn" | "err" | "idle" | "working"} size={8} pulse={prov.kind === "working"}/>
          {prov.name}
          {prov.label ? <span className="sep">·</span> : null}
          {prov.label}
        </span>
        {voiceState !== "idle" && (
          <span className="item"><Icon.Mic width={12} height={12}/> Voice: {voiceState}</span>
        )}
        <span className="right">
          <span className="item"><span style={{ opacity: 0.7 }}>UTF-8</span></span>
          <span className="item"><span style={{ opacity: 0.7 }}>LF</span></span>
          <span className="item"><span style={{ opacity: 0.7 }}>TypeScript</span></span>
          <span className="item"><span style={{ opacity: 0.7 }}>Ln 1, Col 1</span></span>
          <span className="item"><span style={{ opacity: 0.7 }}>100%</span></span>
        </span>
      </div>
    </div>
  );
}

function isTyping(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
