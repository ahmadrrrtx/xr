/** The XR sigil: glossy core + tilted equatorial ring, in one small SVG. */
export function XRWordmark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="XR">
      <defs>
        <radialGradient id="xr-mark-core" cx="34%" cy="28%" r="80%">
          <stop offset="0%" stopColor="#2A3A4E" />
          <stop offset="36%" stopColor="#0B1220" />
          <stop offset="100%" stopColor="#02040A" />
        </radialGradient>
        <linearGradient id="xr-mark-ring" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--metal-bright)" stopOpacity="0.2" />
          <stop offset="45%" stopColor="var(--metal-bright)" stopOpacity="0.95" />
          <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--metal)" stopOpacity="0.2" />
        </linearGradient>
        <radialGradient id="xr-mark-halo" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
          <stop offset="70%" stopColor="var(--accent-dim)" stopOpacity="0.06" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="50" cy="50" r="48" fill="url(#xr-mark-halo)" />
      <circle cx="50" cy="50" r="34" fill="url(#xr-mark-core)" />
      <g transform="rotate(-19 50 50)">
        <ellipse
          cx="50"
          cy="50"
          rx="44"
          ry="12"
          fill="none"
          stroke="url(#xr-mark-ring)"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>
      <circle cx="50" cy="50" r="34" fill="url(#xr-mark-core)" opacity="0.92" />
      <g transform="rotate(-19 50 50)">
        <path d="M 6 50 A 44 12 0 0 0 94 50" fill="none" stroke="url(#xr-mark-ring)" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <circle cx="40" cy="32" r="9" fill="#FFFFFF" opacity="0.09" />
      <circle cx="50" cy="50" r="3.4" fill="var(--accent)" opacity="0.95" />
    </svg>
  );
}
