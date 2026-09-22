import { useEffect, useRef, useState } from "react";
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const enterRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setOpen(true); } catch { setOpen(true); }
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    // Focus the primary action after paint so screen readers land in the modal.
    const tid = window.setTimeout(() => enterRef.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); skip(); return; }
      if (e.key !== "Tab") return;
      // Simple focus trap: keep Tab inside the modal card.
      const card = cardRef.current;
      if (!card) return;
      const focusables = card.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])");
      if (!focusables.length) return;
      const first = focusables[0]; const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(tid);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function finish() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ launch, notif, at: Date.now() }));
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
    <div className="xr-onboard" role="dialog" aria-modal="true" aria-labelledby="xr-ob-title" aria-describedby="xr-ob-sub">
      <div className="xr-onboard-card" ref={cardRef}>
        <h1 id="xr-ob-title">Welcome to XR</h1>
        <p className="sub" id="xr-ob-sub">Everything runs locally on this machine. Approvals are required before XR touches files, shells, or sends data — nothing happens without you.</p>

        <div className="xr-onboard-row">
          <span className="icon" aria-hidden="true"><Icon.Shield width={16} height={16}/></span>
          <div><b>Trust, by default</b><div className="faint">Every shell, file write, and network call is gated. The Trust Center shows a full audit log.</div></div>
        </div>
        <div className="xr-onboard-row">
          <span className="icon" aria-hidden="true"><Icon.Mic width={16} height={16}/></span>
          <div><b>Voice is offline-first</b><div className="faint">Speech recognition runs on-device. Press <kbd>Space</kbd> or the mic to talk, <kbd>Esc</kbd> to dock.</div></div>
        </div>
        <div className="xr-onboard-row">
          <span className="icon" aria-hidden="true"><Icon.Bell width={16} height={16}/></span>
          <div><b>Control stays with you</b><div className="faint">Computer Control ships disabled until you turn it on. STOP is always one click away.</div></div>
        </div>

        <div className="xr-onboard-actions">
          <label className="xr-onboard-toggle"><input type="checkbox" checked={launch} onChange={e=>setLaunch(e.target.checked)} aria-label="Launch XR at login"/> Launch XR at login</label>
          <label className="xr-onboard-toggle"><input type="checkbox" checked={notif} onChange={e=>setNotif(e.target.checked)} aria-label="Allow notifications"/> Allow notifications</label>
          <span className="spacer"/>
          <button className="xr-btn xr-btn--ghost xr-btn--sm" onClick={skip}>Skip for now</button>
          <button className="xr-btn xr-btn--primary xr-btn--sm" onClick={finish} ref={enterRef} autoFocus>Enter XR</button>
        </div>
      </div>
    </div>
  );
}
export default Onboarding;
