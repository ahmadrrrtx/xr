import type { SVGProps } from "react";

type StatusKind = "ok" | "warn" | "err" | "info" | "idle" | "working";

const color = (k: StatusKind) =>
  k === "ok" ? "var(--xr-success)" :
  k === "warn" ? "var(--xr-warning)" :
  k === "err" ? "var(--xr-error)" :
  k === "working" ? "var(--xr-primary)" :
  k === "info" ? "var(--xr-info)" :
  "var(--xr-muted)";

export function StatusDot({ kind = "idle", size = 8, title, pulse, style, ...rest }:
  SVGProps<SVGSVGElement> & { kind?: StatusKind; size?: number; pulse?: boolean }) {
  const c = color(kind);
  return (
    <span className="xr-dot-wrap" style={{ display: "inline-grid", placeItems: "center", width: size + 8, height: size + 8, ...style }} title={title}>
      {pulse && <span className="xr-dot-pulse" style={{ background: c }}/>}
      <svg width={size} height={size} viewBox="0 0 8 8" {...rest}>
        <circle cx="4" cy="4" r={kind === "err" ? 3.5 : 3} fill={c}/>
      </svg>
    </span>
  );
}
