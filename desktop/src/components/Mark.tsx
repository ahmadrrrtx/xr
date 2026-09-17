/**
 * Canonical XR mark — vector derivation of the official logo (assets/logo.png):
 * X-blade cross + orbit ellipse + luminous orb; gradient cyan→violet; green life-dot.
 * Geometry spec: docs/xr-rebuild/XR_ASSET_AUDIT.md §4 / XR_DESIGN_SYSTEM.md §1.
 * Mono variant via `mono` prop (tray/CLI/print).
 */
export function Mark({ size = 22, mono = false }: { size?: number; mono?: boolean }) {
  const gid = mono ? undefined : "xrg";
  const stroke = mono ? "currentColor" : `url(#${gid})`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="XR" fill="none">
      {!mono && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00D4FF" />
            <stop offset="1" stopColor="#6048F8" />
          </linearGradient>
        </defs>
      )}
      {/* X blades */}
      <path d="M10 10 L24 27 L38 10" stroke={stroke} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 38 L20 26" stroke={mono ? stroke : "#6048F8"} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M38 38 L28 26" stroke={mono ? stroke : "#6048F8"} strokeWidth="4.5" strokeLinecap="round" />
      {/* orbit */}
      <ellipse cx="24" cy="26" rx="17" ry="7" stroke={stroke} strokeWidth="1.6" transform="rotate(-18 24 26)" opacity="0.85" />
      {/* orb */}
      <circle cx="24" cy="25" r="4.2" fill={mono ? "currentColor" : "#00D4FF"} />
      <circle cx="24" cy="25" r="6.4" stroke={mono ? "currentColor" : "#00D4FF"} strokeOpacity="0.35" strokeWidth="1.2" />
      {/* life dot */}
      <circle cx="33" cy="33" r="1.8" fill={mono ? "currentColor" : "#00FF88"} />
    </svg>
  );
}
