import type { DaemonStatus } from "../../shared/protocol";
import { post } from "../vscode";

/** 36px header: sentinel, model (click to switch), spend today, status, clear. */
export function Header({
  status,
  busy,
  iconUri,
  hasMessages,
}: {
  status: DaemonStatus;
  busy: boolean;
  iconUri: string;
  hasMessages: boolean;
}) {
  const online = status.state === "connected";
  const modelLabel = online ? status.model ?? "Choose model" : "XR offline";
  const spend = typeof status.spendTodayUsd === "number" ? `$${status.spendTodayUsd.toFixed(2)} today` : "";
  return (
    <header className="top">
      <div className="brand">
        {iconUri ? <img className="sentinel" src={iconUri} alt="" width={18} height={18} /> : null}
        <span className="brand-name">XR</span>
      </div>
      <button
        type="button"
        className="model-chip"
        aria-label={`Switch model. Current: ${modelLabel}`}
        title={status.provider ? `${status.provider} · ${status.model ?? ""}` : "Switch model"}
        onClick={() => post({ type: "switchModel" })}
      >
        {modelLabel}
      </button>
      <button
        type="button"
        className="spend"
        title="Open budget"
        aria-label={spend ? `Spent ${spend}. Open budget` : "Open budget"}
        onClick={() => post({ type: "showBudget" })}
      >
        {spend}
      </button>
      <span className={`status-dot ${status.state}`} role="img" aria-label={stateLabel(status.state, busy)} title={stateLabel(status.state, busy)} />
      <button
        type="button"
        className="chip-btn"
        aria-label="Clear conversation"
        disabled={!hasMessages || busy}
        onClick={() => post({ type: "clear" })}
      >
        Clear
      </button>
    </header>
  );
}

function stateLabel(state: DaemonStatus["state"], busy: boolean): string {
  if (busy) return "Working";
  switch (state) {
    case "connected":
      return "Connected to XR daemon";
    case "connecting":
      return "Connecting to XR daemon";
    case "unauthorized":
      return "Token rejected by XR daemon";
    case "offline":
      return "XR daemon not running";
  }
}
