import { cn } from "@/lib/utils";

/**
 * XR Official Mark — vector-identical to the repository's official brand
 * asset `assets/logo.svg` (cyan #00D4FF → violet #6048F8, green #00FF88).
 * Do not restyle: this is the canonical identity.
 */
export function XrMark({ className, size = 26 }: { className?: string; size?: number }) {
  const uid = "xrmark";
  return (
    <svg
      width={size * 1.25}
      height={size}
      viewBox="0 0 120 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="XR logo"
      className={className}
    >
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00D4FF" />
          <stop offset="1" stopColor="#6048F8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="116" height="92" rx="18" fill="#0A0A0F" />
      <rect x="2" y="2" width="116" height="92" rx="18" fill="none" stroke={`url(#${uid})`} strokeWidth="3" />
      <path d="M32 26 L60 58 L88 26" fill="none" stroke="#00D4FF" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 70 L54 46" fill="none" stroke="#6048F8" strokeWidth="8" strokeLinecap="round" />
      <path d="M88 70 L66 46" fill="none" stroke="#6048F8" strokeWidth="8" strokeLinecap="round" />
      <circle cx="60" cy="64" r="4.5" fill="#00FF88" />
    </svg>
  );
}

/** Official avatar mark (circle lockup from assets/avatar.svg). */
export function XrAvatarMark({ className, size = 22 }: { className?: string; size?: number }) {
  const uid = "xravatar";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="XR avatar"
      className={className}
    >
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#00D4FF" />
          <stop offset="1" stopColor="#6048F8" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="48" r="46" fill="#0A0A0F" />
      <circle cx="48" cy="48" r="46" fill="none" stroke={`url(#${uid})`} strokeWidth="3" />
      <path d="M30 30 L48 52 L66 30" fill="none" stroke="#00D4FF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 66 L43 50" fill="none" stroke="#6048F8" strokeWidth="6" strokeLinecap="round" />
      <path d="M66 66 L53 50" fill="none" stroke="#6048F8" strokeWidth="6" strokeLinecap="round" />
      <circle cx="48" cy="59" r="3.5" fill="#00FF88" />
    </svg>
  );
}

/** Nav lockup: official mark + wordmark. */
export function XrLogo({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}
      aria-label="XR"
    >
      <XrMark size={size} className="drop-shadow-[0_0_14px_rgba(0,212,255,0.35)]" />
      <span className="text-[17px] text-white">XR</span>
    </span>
  );
}
