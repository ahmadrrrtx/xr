import type { ReactNode } from "react";
import { XrLogo, XrAvatar } from "./Brand";

export type Area = "home" | "work" | "workspace" | "agents" | "library" | "trust" | "runs" | "settings";

const NAV: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" /> },
  { id: "work", label: "Work", icon: <path d="M4 6h16M4 12h10M4 18h7M17 13l4 4-4 4" /> },
  { id: "workspace", label: "Workspace", icon: <path d="M3 6h6l2 2h10v11H3zM10 12v4M8 14h4" /> },
  { id: "agents", label: "Agents", icon: <path d="M12 4v5M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 20a6 6 0 0 1 12 0" /> },
  { id: "library", label: "Library", icon: <path d="M4 5h5v15H4zM10 5h5v15h-5zM16 5l4 1-3 14-4-1" /> },
  { id: "runs", label: "Runs", icon: <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" /> },
  { id: "trust", label: "Trust", icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /> },
  { id: "settings", label: "Settings", icon: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 12h2M18 12h2M12 4v2M12 18v2M6.5 6.5l1.5 1.5M16 16l1.5 1.5M17.5 6.5L16 8M8 16l-1.5 1.5" /> },
];

export function AppShell({
  area,
  onArea,
  workspace,
  engineVersion,
  children,
}: {
  area: Area;
  onArea: (a: Area) => void;
  workspace: string;
  engineVersion: string | null;
  children: ReactNode;
}) {
  const label = NAV.find((n) => n.id === area)?.label ?? "";
  return (
    <div className="shell">
      <header className="titlebar">
        <XrLogo height={24} radius={5} />
        <span className="crumb">
          XR <span className="faint">›</span> <b>{workspace}</b> <span className="faint">›</span> {label}
        </span>
        <span className="mono faint" style={{ marginLeft: "auto", fontSize: 11 }}>
          engine {engineVersion ?? "—"}
        </span>
      </header>
      <nav className="rail" aria-label="Primary">
        {NAV.map((n) => (
          <button
            key={n.id}
            title={n.label}
            aria-label={n.label}
            aria-current={n.id === area ? "page" : undefined}
            onClick={() => onArea(n.id)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {n.icon}
            </svg>
          </button>
        ))}
        <div className="spacer" />
        <span title="XR presence (idle)" aria-label="XR presence idle">
          <XrAvatar size={26} />
        </span>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
