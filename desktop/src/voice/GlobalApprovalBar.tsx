import { useVoice } from "./session";

/** Phase 4 · global approval-interrupt bar.
 *
 * When voice is live and an approval is pending, this floats on every surface
 * (not just /voice) so the user doesn't have to be on the voice screen to
 * notice. "Barge in" stops TTS and opens the mic; "Decide now" jumps to the
 * Trust Queue. Work keeps running either way — the durable engine store is
 * what decides, not the shell. */
export function GlobalApprovalBar({ onDecide }: { onDecide: () => void }) {
  const voice = useVoice();
  if (!voice.approval) return null;
  return (
    <div className="xr-global-approval" role="alert">
      <span className="xr-global-approval-dot" aria-hidden="true"/>
      <span className="xr-global-approval-body">
        <b>{voice.approval.tool ?? voice.approval.id}</b>
        <span className="faint">{voice.approval.reason ? ` — ${voice.approval.reason}` : " approval pending — say confirm or cancel"}</span>
      </span>
      <span className="spacer"/>
      <button className="xr-btn xr-btn--sm xr-btn--ghost" onClick={voice.bargeIn}>barge in</button>
      <button className="xr-btn xr-btn--sm xr-btn--primary" onClick={onDecide}>decide now</button>
    </div>
  );
}
export default GlobalApprovalBar;
