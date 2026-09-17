import { useEffect, useState, type ReactNode } from "react";
import { XrLogo, XrAvatar } from "./Brand";
import { api, asList, type ProviderInfo } from "../api/client";

export type Area = "home" | "work" | "workspace" | "agents" | "library" | "trust" | "runs" | "settings";

/* Phase 6 · mock-accurate icon rail. Left: work areas. Bottom: settings + presence. */
const NAV: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" /> },
  { id: "work", label: "Work (chat)", icon: <path d="M4 5h16v10H9l-5 4z" /> },
  { id: "workspace", label: "Workspace (files)", icon: <path d="M3 6h6l2 2h10v11H3zM10 12v4M8 14h4" /> },
  { id: "runs", label: "Team runs", icon: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M17 20a5.5 5.5 0 0 0-2-4" /> },
  { id: "library", label: "Library", icon: <path d="M6 4h3v16H6zM11 4h3v16h-3zM16.5 5.2l2.9.8-3.6 13.6-2.9-.8z" /> },
  { id: "trust", label: "Trust Center", icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /> },
];

const BOTTOM: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4.5 12l-1.8 1 1 1.8-.5 2 2 .5 1 1.8 1.8-1 2 .5.5-2 1.8-1-1-1.8.5-2-2-.5-1-1.8-1.8 1-2-.5-.5 2-1.8 1zM21.3 13l-1.8-1 .5-2-2-.5-1-1.8" /> },
];

export function AppShell({
  area,
  onArea,
  engineVersion,
  children,
}: {
  area: Area;
  onArea: (a: Area) => void;
  engineVersion: string | null;
  children: ReactNode;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [up, setUp] = useState(true);

  useEffect(() => {
    let live = true;
    const poll = () => {
      api.health().then(() => { if (live) setUp(true); }).catch(() => { if (live) setUp(false); });
      api.providers().then((p) => { if (live) setProviders(asList<ProviderInfo>(p, "providers", "items")); }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  const active = providers.find((p) => p.available !== false);
  const NavBtn = ({ n }: { n: { id: Area; label: string; icon: ReactNode } }) => (
    <button
      className={n.id === area ? "rbtn on" : "rbtn"}
      title={n.label}
      aria-label={n.label}
      aria-current={n.id === area ? "page" : undefined}
      onClick={() => onArea(n.id)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {n.icon}
      </svg>
    </button>
  );

  return (
    <div className="shell">
      <header className="titlebar">
        <XrLogo height={22} radius={5} />
        <span className="appname">XR Desktop</span>
        <span className="tb-sep" />
        <span className="crumb mono faint">{NAV.find((n) => n.id === area)?.label ?? ""}</span>
        <span className="mono faint tb-right">engine {engineVersion ?? "—"}</span>
      </header>
      <nav className="rail" aria-label="Primary">
        {NAV.map((n) => <NavBtn key={n.id} n={n} />)}
        <div className="spacer" />
        {BOTTOM.map((n) => <NavBtn key={n.id} n={n} />)}
        <span className="rail-presence" title="XR presence" aria-label="XR presence">
          <XrAvatar size={26} />
        </span>
      </nav>
      <main className="main">{children}</main>
      <footer className="statusbar" aria-label="Status">
        <span className={up ? "sb-item ok" : "sb-item bad"}>
          <i className="dot" aria-hidden="true" /> Engine {up ? "connected" : "offline"}
        </span>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item" title="Active provider (engine-reported)">
          {active?.id ?? "no provider"}{active?.local ? " · local" : ""}
        </span>
        <span className="sb-spacer" />
        <span className="sb-item off" title="Voice pipeline is not enabled in this build">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12M8 11a4 4 0 0 0 8 0M5 21h14M4 4l16 16" /></svg>
          VOICE OFFLINE
        </span>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item mono">{engineVersion ?? "v—"}</span>
      </footer>
    </div>
  );
}
