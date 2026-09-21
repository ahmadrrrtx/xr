import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";
import { pushToast } from "../components/ToastBus";

type Entry = {
  id: string; what: string; scope: "workspace" | "global" | "session";
  src: string; t: string; kind: "fact" | "preference" | "mistake" | "todo";
};

const ENTRIES: Entry[] = [
  { id: "1", what: "User prefers Vim keybindings when editing.", scope: "global", src: "stated in chat", t: "2d ago", kind: "preference" },
  { id: "2", what: "This project uses Bun; never suggest npm install without asking.", scope: "workspace", src: "observed", t: "yesterday", kind: "fact" },
  { id: "3", what: "PRs must include screenshots of UI changes.", scope: "workspace", src: "CONTRIBUTING.md", t: "3h ago", kind: "fact" },
  { id: "4", what: "Mistake: ran `bun dev` from / instead of /desktop — wrong cwd.", scope: "session", src: "run #41", t: "2h ago", kind: "mistake" },
  { id: "5", what: "Finish writing Memory screen export to JSON.", scope: "session", src: "task list", t: "now", kind: "todo" },
];

export function Memory() {
  const [entries, setEntries] = useState(ENTRIES);
  return (
    <div className="xr-page">
      <div className="xr-page-head">
        <div>
          <h1>Memory</h1>
          <p className="xr-subtitle">What XR remembers about you, this workspace, and this session.</p>
        </div>
        <div className="xr-page-head-actions">
          <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={() => pushToast("info","Exported","memory.json downloaded")}><Icon.Download width={12} height={12}/> Export JSON</button>
          <button className="xr-btn xr-btn--sm xr-btn--secondary" onClick={() => {
            if (confirm("Forget all session entries?")) setEntries(es => es.filter(e => e.scope !== "session"));
          }}><Icon.Trash width={12} height={12}/> Clear session</button>
        </div>
      </div>
      <div className="xr-stat-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", margin: "0 0 16px" }}>
        <div className="xr-stat-card"><StatusDot kind="ok" size={8}/><div className="label">Global facts</div><div className="value mono">{entries.filter(e => e.scope === "global").length}</div></div>
        <div className="xr-stat-card"><StatusDot kind="info" size={8}/><div className="label">Workspace facts</div><div className="value mono">{entries.filter(e => e.scope === "workspace").length}</div></div>
        <div className="xr-stat-card"><StatusDot kind="warn" size={8}/><div className="label">Session</div><div className="value mono">{entries.filter(e => e.scope === "session").length}</div></div>
        <div className="xr-stat-card"><StatusDot kind="err" size={8}/><div className="label">Learned mistakes</div><div className="value mono">{entries.filter(e => e.kind === "mistake").length}</div></div>
      </div>
      <div style={{ marginTop: 16 }}>
        {entries.map(e => (
          <div key={e.id} className="xr-memory-card">
            <div className="mem-meta">
              <span className={"xr-memory-scope " + e.scope}>{e.scope}</span>
              <span className="mem-src">{e.src}</span>
              <span className="mono faint" style={{ marginLeft: "auto" }}>{e.t}</span>
            </div>
            <div className="mem-what">{e.what}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
