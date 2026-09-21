import { useState } from "react";
import { Icon } from "./icons";

export type DiffHunk = {
  id: string;
  added: string[];
  removed: string[];
  context?: string;
  accepted?: boolean; // working tree has it; accept is no-op until user rejects
  rejected?: boolean;
};

export function DiffViewer({ path, hunks, onReject, onAcceptAll }: {
  path: string;
  hunks: DiffHunk[];
  onReject: (hunkId: string) => void;
  onAcceptAll?: () => void;
}) {
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  function reject(id: string) {
    setRejected(s => new Set(s).add(id));
    onReject(id);
  }
  if (!hunks.length) {
    return (
      <div className="xr-empty">
        <Icon.Check width={48} height={48} className="ic"/>
        <h3>No changes in this file</h3>
        <p>The working tree matches what was there before. XR hasn't made any edits here.</p>
      </div>
    );
  }
  return (
    <div className="xr-diff">
      <div className="xr-diff-head">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon.File width={14} height={14}/>
          <span className="mono" style={{ fontSize: 12 }}>{path}</span>
          <span className="xr-pill xr-pill--low">{hunks.length} hunk{hunks.length > 1 ? "s" : ""}</span>
        </div>
        {onAcceptAll && (
          <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={onAcceptAll}><Icon.Check width={12} height={12}/> Accept all & save</button>
        )}
      </div>
      {hunks.map((h, i) => (
        <div key={h.id} className={"xr-hunk" + (rejected.has(h.id) ? " rejected" : "")}>
          {h.context && <div className="xr-hunk-ctx">@@ {h.context}</div>}
          {h.removed.map((l, j) => (
            <div key={"r"+j} className="xr-line xr-line--del"><span className="ln"/><span className="ln"/><span className="mk">-</span><span className="ct">{l}</span></div>
          ))}
          {h.added.map((l, j) => (
            <div key={"a"+j} className="xr-line xr-line--add"><span className="ln"/><span className="ln"/><span className="mk">+</span><span className="ct">{l}</span></div>
          ))}
          <div className="xr-hunk-actions">
            {rejected.has(h.id) ? (
              <span className="xr-pill xr-pill--warn">Reverted</span>
            ) : (
              <>
                <button className="xr-btn xr-btn--sm" onClick={() => reject(h.id)}><Icon.X width={11} height={11}/> Revert hunk</button>
                <span className="xr-dim" style={{ fontSize: 11 }}>kept (+{h.added.length}/-{h.removed.length})</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
