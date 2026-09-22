import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { api } from "../api/client";

/** Phase 5 · engine-down honest banner.
 *
 * When /health fails or is slow, XR surfaces a top-alert strip across the UI
 * rather than silently hiding the failure. The banner offers Retry + a link
 * to Diagnostics and, when the engine recovers, dismisses itself. Checkpoint
 * resume / recovery note is shown so users know work is not lost. */
export function EngineDownBanner({ onDiagnostics, onRetry }: { onDiagnostics: () => void; onRetry?: () => void }) {
  const [down, setDown] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const probe = async () => {
      try {
        const start = performance.now();
        await api.health?.();
        const isDown = performance.now() - start > 2500;
        if (!alive) return;
        setDown(isDown);
        document.body.classList.toggle("has-engine-down", isDown);
      } catch {
        if (!alive) return;
        setDown(true);
        document.body.classList.add("has-engine-down");
      }
    };
    probe();
    timer = window.setInterval(probe, 5000);
    return () => {
      alive = false;
      document.body.classList.remove("has-engine-down");
      if (timer) window.clearInterval(timer);
    };
  }, []);

  if (!down) return null;
  return (
    <div className="xr-engine-down" role="alert">
      <Icon.AlertTriangle width={16} height={16}/>
      <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4 }}>
        <b>Engine unreachable.</b>
        <span className="faint"> Status unavailable — continuing. Checkpoints are preserved; work resumes when the daemon returns.</span>
      </div>
      <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={() => { setChecking(true); (onRetry?.() ?? Promise.resolve()); setTimeout(() => { setChecking(false); }, 600); }} disabled={checking}>
        <Icon.RotateCw width={12} height={12} style={{ animation: checking ? "xr-spin 1s linear infinite" : "none" }}/>
        {checking ? " Retrying…" : " Retry"}
      </button>
      <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={onDiagnostics}>Diagnostics</button>
      <style>{`@keyframes xr-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
export default EngineDownBanner;
