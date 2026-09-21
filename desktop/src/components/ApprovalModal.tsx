import { useEffect, useState } from "react";
import { Icon } from "./icons";

export type RiskTier = "low" | "medium" | "high";

export interface ApprovalRequest {
  id: string;
  title: string;
  action: string;
  detail: string;
  reason: string;
  risk: RiskTier;
  ttlMs?: number;
  editable?: boolean;
}

export function ApprovalModal({ req, onApprove, onDeny, onAlwaysAllow, onEdit }: {
  req: ApprovalRequest | null;
  onApprove: (id: string, command?: string) => void;
  onDeny: (id: string) => void;
  onAlwaysAllow?: (id: string) => void;
  onEdit?: (id: string, command: string) => void;
}) {
  const [remaining, setRemaining] = useState(req?.ttlMs ?? 60_000);
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(req?.action ?? "");

  useEffect(() => {
    if (!req?.ttlMs) return;
    setRemaining(req.ttlMs);
    const start = Date.now();
    const t = setInterval(() => {
      const left = (req.ttlMs ?? 60_000) - (Date.now() - start);
      if (left <= 0) { clearInterval(t); onDeny(req.id); return; }
      setRemaining(left);
    }, 250);
    return () => clearInterval(t);
  }, [req?.id, req?.ttlMs, onDeny]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!req) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onApprove(req.id, editing ? edited : undefined); }
      if (e.key === "Escape") { e.preventDefault(); onDeny(req.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, onApprove, onDeny, editing, edited]);

  if (!req) return null;

  const riskColor = req.risk === "high" ? "var(--xr-error)" : req.risk === "medium" ? "var(--xr-warning)" : "var(--xr-primary)";
  const pct = Math.max(0, Math.min(1, remaining / (req.ttlMs ?? 60_000)));
  const secs = Math.ceil(remaining / 1000);

  return (
    <div className="xr-modal-backdrop">
      <div className="xr-modal xr-approval" role="dialog" aria-modal="true" aria-labelledby="appr-title">
        <div className="xr-approval-head">
          <div className="xr-approval-shield" style={{ color: riskColor, borderColor: riskColor, boxShadow: `0 0 28px ${riskColor}33` }}>
            <Icon.Shield width={26} height={26}/>
          </div>
          <div style={{ flex: 1 }}>
            <div className="xr-approval-eyebrow" style={{ color: riskColor }}>XR wants to {req.title}</div>
            <h2 id="appr-title" style={{ margin: "2px 0 0", fontSize: 17, fontWeight: 600 }}>{req.detail}</h2>
          </div>
          <div className="xr-approval-countdown" style={{ "--c": riskColor } as React.CSSProperties}>
            <svg width="44" height="44" viewBox="0 0 44 44">
              <circle cx="22" cy="22" r="19" fill="none" stroke="var(--xr-surface-3)" strokeWidth="3"/>
              <circle cx="22" cy="22" r="19" fill="none" stroke={riskColor} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*19}`} strokeDashoffset={`${2*Math.PI*19*(1-pct)}`}
                transform="rotate(-90 22 22)" style={{ transition: "stroke-dashoffset 250ms linear" }}/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 600 }}>{secs}s</span>
          </div>
        </div>

        <div className="xr-approval-body">
          <div className="xr-approval-row">
            <span className="xr-approval-k">Command</span>
            {editing ? (
              <input className="xr-input xr-mono" value={edited} onChange={(e) => setEdited(e.target.value)} autoFocus style={{ fontFamily: "var(--xr-font-mono)", fontSize: 12 }}/>
            ) : (
              <code className="xr-mono xr-approval-code">{req.action}</code>
            )}
          </div>
          <div className="xr-approval-row">
            <span className="xr-approval-k">Why</span>
            <span className="xr-dim" style={{ fontSize: 12.5 }}>{req.reason}</span>
          </div>
          <div className="xr-approval-row">
            <span className="xr-approval-k">Risk</span>
            <span className="xr-pill" style={{ color: riskColor, borderColor: `${riskColor}55`, background: `${riskColor}14` }}>{req.risk}</span>
          </div>
        </div>

        <div className="xr-approval-foot">
          {onAlwaysAllow && (
            <button className="xr-btn xr-btn--ghost xr-btn--sm" onClick={() => onAlwaysAllow(req.id)}>Always allow for this project</button>
          )}
          {req.editable && (
            <button className="xr-btn xr-btn--ghost xr-btn--sm" onClick={() => setEditing(v => !v)}>
              {editing ? <><Icon.Check width={12} height={12}/> Done editing</> : <><Icon.Edit width={12} height={12}/> Edit command</>}
            </button>
          )}
          <div style={{ flex: 1 }}/>
          <button className="xr-btn xr-btn--secondary" onClick={() => onDeny(req.id)}>Deny <span className="xr-keycap" style={{ marginLeft: 6 }}>Esc</span></button>
          <button className="xr-btn xr-btn--primary" onClick={() => onApprove(req.id, editing ? edited : undefined)}>
            Approve <span className="xr-keycap" style={{ marginLeft: 6, background: "rgba(0,0,0,0.18)", color: "var(--xr-on-primary)" }}>⌘↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
