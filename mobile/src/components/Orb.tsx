import { motion } from 'framer-motion';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface OrbProps {
  size?: number;
  state?: OrbState;
  /** Mic loudness 0..1 — drives the voice rings. */
  level?: number;
  onClick?: () => void;
  label?: string;
}

/**
 * The XR Orb — brand hero of the Voice tab.
 *
 * Glossy black sphere (smooth, no segmentation), tilted equatorial ring in
 * brushed silver over the cyan core glow, and concentric voice rings that
 * answer the mic while listening. Matches the desktop Phase 16 companion Orb.
 */
export function Orb({ size = 180, state = 'idle', level = 0, onClick, label }: OrbProps) {
  const halo = state === 'listening' ? 1 : state === 'speaking' ? 0.8 : 0.5;
  const rings = state === 'listening' || state === 'speaking';

  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label ?? `XR orb, ${state}`}
      className="relative flex items-center justify-center rounded-full"
      style={{ width: size, height: size }}
      animate={{ scale: state === 'listening' ? 1.03 : 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      whileTap={{ scale: 0.97 }}
    >
      {/* Cyan halo */}
      <svg
        width={size * 1.9}
        height={size * 1.9}
        viewBox="0 0 100 100"
        className="pointer-events-none absolute"
        aria-hidden
      >
        <defs>
          <radialGradient id="xr-orb-halo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.42 * halo} />
            <stop offset="38%" stopColor="var(--accent)" stopOpacity={0.16 * halo} />
            <stop offset="72%" stopColor="var(--accent-dim)" stopOpacity={0.05 * halo} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill="url(#xr-orb-halo)" />
      </svg>

      {/* Voice rings — answer the mic */}
      {rings
        ? [0, 1, 2].map((index) => (
            <motion.span
              key={index}
              className="pointer-events-none absolute rounded-full"
              style={{
                width: size,
                height: size,
                border: '1px solid var(--accent)',
              }}
              initial={{ scale: 0.92, opacity: 0.5 }}
              animate={{
                scale: [0.92, 1 + 0.22 + level * 0.3 + index * 0.06],
                opacity: [0.5, 0],
              }}
              transition={{
                duration: 1.9,
                repeat: Infinity,
                delay: index * 0.62,
                ease: 'easeOut',
              }}
              aria-hidden
            />
          ))
        : null}

      {/* Core */}
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
        <defs>
          <radialGradient id="xr-orb-core" cx="34%" cy="28%" r="78%">
            <stop offset="0%" stopColor="#1C2836" />
            <stop offset="30%" stopColor="#080D16" />
            <stop offset="72%" stopColor="#02050B" />
            <stop offset="100%" stopColor="#010204" />
          </radialGradient>
          <radialGradient id="xr-orb-gloss" cx="32%" cy="24%" r="38%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.22" />
            <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="xr-orb-ring" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--metal-bright)" stopOpacity="0.15" />
            <stop offset="42%" stopColor="var(--metal-bright)" stopOpacity="0.95" />
            <stop offset="58%" stopColor="var(--accent)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--metal)" stopOpacity="0.25" />
          </linearGradient>
          <filter id="xr-orb-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        <circle cx="50" cy="50" r="37" fill="url(#xr-orb-core)" />
        <circle
          cx="50"
          cy="50"
          r="37"
          fill="none"
          stroke="var(--accent)"
          strokeOpacity={state === 'idle' ? 0.16 : 0.34}
          strokeWidth="0.5"
        />

        {/* Tilted equatorial ring, front arc */}
        <g transform="rotate(-19 50 50)">
          <ellipse
            cx="50"
            cy="50"
            rx="46"
            ry="13"
            fill="none"
            stroke="url(#xr-orb-ring)"
            strokeWidth="2.1"
            strokeLinecap="round"
            opacity={0.95}
          />
          <ellipse
            cx="50"
            cy="50"
            rx="46"
            ry="13"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity={0.28}
            filter="url(#xr-orb-soft)"
          />
        </g>

        {/* Re-cover the sphere so the ring reads as passing behind it */}
        <circle cx="50" cy="50" r="37" fill="url(#xr-orb-core)" />
        {/* Front half of the ring */}
        <g transform="rotate(-19 50 50)">
          <path
            d="M 4 50 A 46 13 0 0 0 96 50"
            fill="none"
            stroke="url(#xr-orb-ring)"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        </g>

        {/* Specular gloss */}
        <circle cx="50" cy="50" r="37" fill="url(#xr-orb-gloss)" />
        <ellipse cx="38" cy="30" rx="11" ry="7" fill="#FFFFFF" opacity="0.1" transform="rotate(-28 38 30)" />

        {/* Inner core glow — brightens with state */}
        <circle
          cx="50"
          cy="50"
          r="9"
          fill="var(--accent)"
          opacity={state === 'listening' ? 0.3 : state === 'speaking' ? 0.24 : 0.14}
          filter="url(#xr-orb-soft)"
        />
        <circle cx="50" cy="50" r="4" fill="var(--accent)" opacity={state === 'idle' ? 0.6 : 1} />
        <circle
          cx="50"
          cy="50"
          r="7"
          fill="none"
          stroke="var(--accent)"
          strokeOpacity={0.35}
          strokeWidth="0.6"
        />
      </svg>
    </motion.button>
  );
}
