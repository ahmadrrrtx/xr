import { XrLogo } from "./Brand";
import { formatBootLine, type BootFact } from "../boot";

/**
 * S0 · boot splash (Phase 1 · D-V3-5). The terminal-splash reference render
 * translated into a live surface: the official logo over the engine's own
 * boot facts. Every line is a fact the shell is genuinely waiting on
 * (src/boot.ts); the timings are measured, the reasons are the engine's.
 *
 * It is only ever mounted when `shouldShowSplash()` says so — a warm boot
 * never sees it — and it holds nothing: the moment the last fact lands the
 * shell replaces it.
 */
export function BootSplash({
  facts,
  failed,
  onRetry,
}: {
  facts: BootFact[];
  failed: boolean;
  onRetry: () => void;
}) {
  const stderr = facts.flatMap((f) => f.stderr ?? []);
  return (
    <div className="boot" data-state={failed ? "failed" : "booting"} role={failed ? "alert" : "status"} aria-live="polite">
      <div className="boot-mark">
        <XrLogo height={88} radius={10} dim={!failed} />
      </div>
      <ol className="boot-lines mono" aria-label="Engine boot">
        {facts.map((f) => {
          const l = formatBootLine(f);
          return (
            <li key={f.key} className="boot-line" data-state={l.state}>
              <span className="boot-label">{l.label}</span>
              <span className="boot-timing">{l.timing}</span>
              <span className="boot-detail">{l.detail}</span>
            </li>
          );
        })}
      </ol>
      {failed && (
        <div className="boot-fail">
          {stderr.length > 0 && (
            <pre className="boot-stderr mono" aria-label="Engine stderr (last lines)">
              {stderr.join("\n")}
            </pre>
          )}
          <p className="boot-help">
            The desktop attaches to the local engine. Start it with <span className="mono">xr serve</span> (or wait
            for the packaged sidecar), then retry — interrupted work resumes from checkpoints.
          </p>
          <div className="splash-actions">
            <button className="btn primary" onClick={onRetry} autoFocus>
              Retry now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
