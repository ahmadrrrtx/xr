import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { native } from "../native";

/** Phase 5 · first-run onboarding (opt-in for native integrations).
 *
 * Shown once on first launch (keyed by localStorage). Lets the user opt into
 * launch-at-login and system notifications; both are OFF by default so the
 * first open is honest. Outside Tauri the native calls are no-ops. */
const KEY = "xr.onboarded.v1";

export function Onboarding({ onDone }: { onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [launch, setLaunch] = useState(false);
  const [notif, setNotif] = useState(false);

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setOpen(true); } catch { setOpen(true); }
  }, []);

  function finish() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ launch, notif, at: Date.now() }));
      // Autostart + notification permission are opt-in; outside Tauri these
      // gracefully no-op via native.ts.
      if (launch) native._autostart?.set?.(true);
      if (notif) void native.requestNotificationPermission();
    } catch { /* ignore */ }
    setOpen(false);
    onDone?.();
  }

  function skip() {
    try { localStorage.setItem(KEY, JSON.stringify({ skipped: true, at: Date.now() })); } catch { /* ignore */ }
    setOpen(false);
    onDone?.();
  }

  if (!open) return null;
  return (
    <div className="xr-onboard" role="dialog" aria-modal="true" aria-labelledby="xr-ob-title">
      <div className="xr-onboard-card">
        <h1 id="xr-ob-title">Welcome to XR</h1>
        <p className="sub">Everything runs locally on this machine. Approvals are required before XR touches files, shells, or sends data — nothing happens without you.</p>

        <div className="xr-onboard-row">
          <span className="icon"><Icon.Shield width={16} height={16}/></span>
          <div><b>Trust, by default</b><div className="faint">Every shell, file write, and network call is gated. The Trust Center shows a full audit log.</div></div>
        </div>
        <div className="xr-onboard-row">
          <span className="icon"><Icon.Mic width={16} height={16}/></span>
          <div><b>Voice is offline-first</b><div className="faint">Speech recognition runs on-device. Press <kbd>Space</kbd> or the mic to talk, <kbd>Esc</kbd> to dock.</div></div>
        </div>
        <div className="xr-onboard-row">
          <span className="icon"><Icon.Bell width={16} height={16}/></span>
          <div><b>Control stays with you</b><div className="faint">Computer Control ships disabled until you turn it on. STOP is always one click away.</div></div>
        </div>

        <div className="xr-onboard-actions">
          <label className="xr-onboard-toggle"><input type="checkbox" checked={launch} onChange={e=>setLaunch(e.target.checked)}/> Launch XR at login</label>
          <label className="xr-onboard-toggle"><input type="checkbox" checked={notif} onChange={e=>setNotif(e.target.checked)}/> Allow notifications</label>
          <span className="spacer"/>
          <button className="xr-btn xr-btn--ghost xr-btn--sm" onClick={skip}>Skip for now</button>
          <button className="xr-btn xr-btn--primary xr-btn--sm" onClick={finish}>Enter XR</button>
        </div>
      </div>
    </div>
  );
}
export default Onboarding;
