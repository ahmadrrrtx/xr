import { useEffect } from "react";
import { Icon } from "./icons";

const SHORTCUTS: Array<{ keys: string[]; desc: string; group: string }> = [
  { keys: ["⌘", "K"], desc: "Open command palette", group: "Global" },
  { keys: ["?"], desc: "Open this cheat sheet", group: "Global" },
  { keys: ["⌘", "1"], desc: "Home", group: "Navigation" },
  { keys: ["⌘", "2"], desc: "Workbench", group: "Navigation" },
  { keys: ["⌘", "3"], desc: "Builder", group: "Navigation" },
  { keys: ["⌘", "4"], desc: "Projects", group: "Navigation" },
  { keys: ["⌘", "5"], desc: "Research", group: "Navigation" },
  { keys: ["⌘", "6"], desc: "Agents", group: "Navigation" },
  { keys: ["⌘", "7"], desc: "Trust Center", group: "Navigation" },
  { keys: ["⌘", "8"], desc: "Voice", group: "Navigation" },
  { keys: ["⌘", ","], desc: "Settings", group: "Navigation" },
  { keys: ["⌘", "L"], desc: "Toggle XR chat panel / focus composer", group: "Workbench" },
  { keys: ["⌘", "B"], desc: "Toggle file explorer", group: "Workbench" },
  { keys: ["⌘", "J"], desc: "Toggle terminal", group: "Workbench" },
  { keys: ["⌘", "N"], desc: "New task", group: "Workbench" },
  { keys: ["⌘", "O"], desc: "Open project / folder", group: "Workbench" },
  { keys: ["⌘", "↵"], desc: "Approve / Send / Start executing", group: "Actions" },
  { keys: ["⌘", "."], desc: "Stop XR / Deny approval", group: "Actions" },
  { keys: ["Esc"], desc: "Close / Cancel / Deny", group: "Actions" },
  { keys: ["⌘", "T"], desc: "New terminal", group: "Terminal" },
  { keys: ["⌘", "P"], desc: "Quick open file", group: "Workbench" },
  { keys: ["⌘", "Shift", "Space"], desc: "Push to talk (voice)", group: "Voice" },
];

export function CheatSheet({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  const groups = Array.from(new Set(SHORTCUTS.map(s => s.group)));
  return (
    <div className="xr-cheat-backdrop" onClick={onClose}>
      <div className="xr-cheat" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Icon.Help width={18} height={18} style={{ color: "var(--xr-primary)" }}/>
          <h2 style={{ margin: 0, fontSize: 18, fontFamily: "var(--xr-font-display)", fontWeight: 600 }}>Keyboard shortcuts</h2>
          <button className="xr-btn xr-btn--icon" style={{ marginLeft: "auto" }} onClick={onClose}><Icon.X width={14} height={14}/></button>
        </div>
        {groups.map(g => (
          <div key={g}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--xr-muted)", textTransform: "uppercase", letterSpacing: "0.04em", margin: "14px 0 6px" }}>{g}</div>
            {SHORTCUTS.filter(s => s.group === g).map((s, i) => (
              <div key={i} className="row">
                <span>{s.desc}</span>
                <span className="keys">
                  {s.keys.map((k, j) => <span key={j} className="xr-keycap">{k}</span>)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
