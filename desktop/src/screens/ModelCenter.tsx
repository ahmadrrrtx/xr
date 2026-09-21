import { useState } from "react";
import { Icon } from "../components/icons";
import { StatusDot } from "../components/StatusDot";

const MODELS = [
  { provider: "Anthropic", name: "Claude Opus 4.6", ctx: "2M", speed: "Slow", quality: "Best", cost: "$$$$", status: "ok", default: false },
  { provider: "Anthropic", name: "Claude Sonnet 4.6", ctx: "2M", speed: "Fast", quality: "Great", cost: "$$", status: "ok", default: true },
  { provider: "Anthropic", name: "Claude Haiku 4.6", ctx: "200k", speed: "Very fast", quality: "Good", cost: "$", status: "ok", default: false },
  { provider: "OpenAI", name: "GPT-5", ctx: "256k", speed: "Medium", quality: "Great", cost: "$$$", status: "ok", default: false },
  { provider: "OpenAI", name: "GPT-5 mini", ctx: "128k", speed: "Very fast", quality: "Good", cost: "$", status: "ok", default: false },
  { provider: "Google", name: "Gemini 2.5 Pro", ctx: "1M", speed: "Fast", quality: "Great", cost: "$", status: "ok", default: false },
  { provider: "xAI", name: "Grok 4", ctx: "256k", speed: "Medium", quality: "Great", cost: "$$", status: "warn", default: false },
  { provider: "Ollama", name: "Llama 3.3 70B", ctx: "128k", speed: "Slow", quality: "Good", cost: "free", status: "err", default: false },
  { provider: "Ollama", name: "Qwen 2.5-Coder 32B", ctx: "128k", speed: "Medium", quality: "Good", cost: "free", status: "err", default: false },
];

export function ModelCenter() {
  const [sel, setSel] = useState("Claude Sonnet 4.6");
  return (
    <div className="xr-page">
      <div className="xr-page-head">
        <div><h1>Models & Providers</h1><p className="xr-subtitle">Choose the default model and configure providers.</p></div>
        <div className="xr-page-head-actions">
          <button className="xr-btn xr-btn--sm xr-btn--ghost"><Icon.Plus width={13} height={13}/> Add provider</button>
        </div>
      </div>

      <div style={{ padding: "0 24px", display: "grid", gridTemplateColumns: "1fr 380px", gap: 20 }}>
        <div>
          <div className="xr-section-header"><h3>Available models</h3>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="xr-filter-chip" aria-pressed="true">All</button>
              <button className="xr-filter-chip" aria-pressed="false">Cloud</button>
              <button className="xr-filter-chip" aria-pressed="false">Local</button>
            </div>
          </div>
          <table className="xr-table">
            <thead><tr><th/><th>Model</th><th>Provider</th><th>Context</th><th>Speed</th><th>Quality</th><th>Cost</th><th/></tr></thead>
            <tbody>
              {MODELS.map(m => (
                <tr key={m.name} className={sel === m.name ? "selected" : ""} onClick={() => setSel(m.name)}>
                  <td><StatusDot kind={m.status === "ok" ? "ok" : m.status as any}/></td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{m.name}{m.default && <span className="xr-pill xr-pill--low" style={{ marginLeft: 8 }}>Default</span>}</div>
                  </td>
                  <td className="faint">{m.provider}</td>
                  <td className="mono">{m.ctx}</td>
                  <td>{m.speed}</td>
                  <td>{m.quality}</td>
                  <td>{m.cost}</td>
                  <td>{m.status !== "ok" && m.default !== true && <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={(e) => { e.stopPropagation(); }}>Fix</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ background: "var(--xr-surface)", border: "1px solid var(--xr-border)", borderRadius: "var(--xr-radius-lg)", padding: 18, alignSelf: "start", height: "fit-content" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--xr-gradient-brand)", display: "grid", placeItems: "center", color: "#000", fontWeight: 700 }}>AI</div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{sel}</div>
              <div className="xr-dim" style={{ fontSize: 11.5 }}>{MODELS.find(m => m.name === sel)?.provider}</div>
            </div>
          </div>
          <div className="xr-policy-row" style={{ padding: "10px 0", background: "transparent", border: "none" }}>
            <div style={{ flex: 1 }}><div className="xr-policy-label">Set as default</div></div>
            <label className="xr-toggle"><input type="checkbox" defaultChecked={MODELS.find(m => m.name === sel)?.default}/><span/></label>
          </div>
          <div className="xr-policy-row" style={{ padding: "10px 0", background: "transparent", border: "none" }}>
            <div style={{ flex: 1 }}><div className="xr-policy-label">Use for planning</div></div>
            <label className="xr-toggle"><input type="checkbox" defaultChecked/><span/></label>
          </div>
          <div className="xr-policy-row" style={{ padding: "10px 0", background: "transparent", border: "none" }}>
            <div style={{ flex: 1 }}><div className="xr-policy-label">Use for code edits</div></div>
            <label className="xr-toggle"><input type="checkbox" defaultChecked/><span/></label>
          </div>
          <button className="xr-btn xr-btn--primary" style={{ width: "100%", marginTop: 8 }}>Save preferences</button>
        </div>
      </div>
    </div>
  );
}
