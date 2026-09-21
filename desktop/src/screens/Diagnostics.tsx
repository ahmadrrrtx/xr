import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";

type Check = { id: string; name: string; status: "ok" | "err" | "warn"; detail: string; fix?: { label: string; action: string } };

const INITIAL: Check[] = [
  { id: "engine", name: "Engine daemon", status: "ok", detail: "Connected · v2.1.0 · 184ms round-trip" },
  { id: "ollama", name: "Ollama (local)", status: "err", detail: "Not reachable on http://127.0.0.1:11434 — local models will fail", fix: { label: "Start Ollama", action: "ollama" } },
  { id: "anthropic", name: "Anthropic API", status: "ok", detail: "Authenticated · 340ms · Sonnet + Opus enabled" },
  { id: "openai", name: "OpenAI API", status: "warn", detail: "API key present but last request was slow (2.4s)" },
  { id: "node", name: "Node.js runtime", status: "ok", detail: "v22.11.0 · npm 10.9.0 on PATH" },
  { id: "git", name: "Git", status: "ok", detail: "git 2.43.0 · authenticated to github.com as ahmadrrtx" },
  { id: "bun", name: "Bun", status: "warn", detail: "Not found — some package operations may be slower", fix: { label: "Install Bun", action: "install-bun" } },
  { id: "docker", name: "Docker", status: "ok", detail: "Docker Desktop 4.34 running · 8 containers" },
  { id: "disk", name: "Disk space", status: "warn", detail: "12.4 GB free on home volume — XR suggests keeping 20 GB" },
  { id: "memory", name: "Memory pressure", status: "ok", detail: "9.2 GB / 32 GB used · swapping not detected" },
  { id: "updates", name: "Updates", status: "ok", detail: "You're on the latest XR build (2.1.0-phase2-a3f9)" },
];

export function Diagnostics() {
  const [checks, setChecks] = useState(INITIAL);
  const [running, setRunning] = useState(false);

  function rerun() {
    setRunning(true);
    setTimeout(() => setRunning(false), 1200);
  }
  function applyFix(id: string, action: string) {
    setChecks(cs => cs.map(c => c.id === id ? { ...c, status: "ok", detail: c.detail + " · fixed" } : c));
  }

  const okCount = checks.filter(c => c.status === "ok").length;
  const errCount = checks.filter(c => c.status === "err").length;
  const warnCount = checks.filter(c => c.status === "warn").length;

  return (
    <div className="xr-page">
      <div className="xr-page-head">
        <div>
          <h1>Diagnostics</h1>
          <p className="xr-subtitle">Check the engine, providers, and local toolchain XR needs to work.</p>
        </div>
        <div className="xr-page-head-actions">
          <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={rerun} disabled={running}>
            <Icon.RotateCw width={13} height={13} style={{ animation: running ? "xr-spin 1s linear infinite" : "none" }}/>
            {running ? " Running checks…" : " Re-run checks"}
          </button>
        </div>
      </div>

      <div className="xr-stat-grid" style={{ padding: "0 24px" }}>
        <div className={"xr-stat-card " + (errCount ? "err" : "ok")}>
          <div className="label">Passing</div><div className="value">{okCount}</div><div className="hint">of {checks.length} checks</div>
        </div>
        <div className={"xr-stat-card " + (errCount ? "err" : "ok")}>
          <div className="label">Errors</div><div className="value">{errCount}</div><div className="hint">will block work</div>
        </div>
        <div className={"xr-stat-card " + (warnCount ? "warn" : "")}>
          <div className="label">Warnings</div><div className="value">{warnCount}</div><div className="hint">degraded experience</div>
        </div>
        <div className="xr-stat-card">
          <div className="label">Engine</div><div className="value" style={{ fontSize: 16 }}>v2.1.0</div><div className="hint">connected</div>
        </div>
      </div>

      <div style={{ padding: "0 24px" }}>
        <div className="xr-section-header"><h3>Checks</h3></div>
        <div className="xr-card-list">
          {checks.map(c => (
            <div key={c.id} className="xr-policy-row">
              <StatusDot kind={c.status === "ok" ? "ok" : c.status as any}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                <div className="xr-dim" style={{ fontSize: 11.5 }}>{c.detail}</div>
              </div>
              {c.fix && c.status !== "ok" && (
                <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={() => applyFix(c.id, c.fix!.action)}>
                  <Icon.Wrench width={12} height={12}/> {c.fix.label}
                </button>
              )}
              {c.status === "ok" && <span className="xr-pill xr-pill--ok">OK</span>}
            </div>
          ))}
        </div>
      </div>

      <style>{`@keyframes xr-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
