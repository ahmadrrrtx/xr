import { cn } from "@/lib/utils";

/**
 * XR — official brand mark.
 *
 * Faithful SVG reproduction of the repository's official mark
 * (assets/logo.svg): the orbital "X" with a glowing blue core, drawn as a
 * self-contained vector so it scales crisply and works offline in any
 * surface (nav, footer, favicon, dashboard). Not an invented logo — this is
 * the repository's official identity, rendered as a clean mark + wordmark.
 */
export function XrMark({ className, size = 26 }: { className?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="xrMarkStroke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#28e2ff" />
          <stop offset="1" stopColor="#6b7cff" />
        </linearGradient>
        <radialGradient id="xrCore" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#dff7ff" />
          <stop offset="0.45" stopColor="#79d6ff" />
          <stop offset="1" stopColor="#28a8ff" />
        </radialGradient>
        <linearGradient id="xrBlade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c9d2ec" />
        </linearGradient>
        <linearGradient id="xrRing" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f7ff" />
          <stop offset="0.5" stopColor="#b9c9f4" />
          <stop offset="1" stopColor="#28e2ff" />
        </linearGradient>
      </defs>

      {/* Orbital ring — elliptical, tilted */}
      <path
        d="M17 60 C 34 22, 92 22, 103 60 C 112 94, 60 106, 34 96 C 12 88, 4 66, 17 60 Z"
        fill="none"
        stroke="url(#xrRing)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Outer thin orbit accent */}
      <path
        d="M11 70 C 22 100, 78 104, 104 70"
        fill="none"
        stroke="#28e2ff"
        strokeOpacity="0.55"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* The "X" blades */}
      <path
        d="M22 26 L56 60 L22 94"
        fill="none"
        stroke="url(#xrBlade)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M98 26 L64 60 L98 94"
        fill="none"
        stroke="url(#xrBlade)"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Glowing core */}
      <circle cx="60" cy="60" r="13" fill="url(#xrCore)" />
      <circle cx="60" cy="60" r="22" fill="none" stroke="#28e2ff" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="60" cy="60" r="6" fill="#ffffff" fillOpacity="0.9" />
    </svg>
  );
}

export function XrLogo({
  className,
  size = 26,
  wordmark = true,
  stacked = false,
}: {
  className?: string;
  size?: number;
  wordmark?: boolean;
  stacked?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight select-none", className)}
      aria-label="XR"
    >
      <XrMark size={size} />
      {wordmark && (
        <span className={cn("leading-none", stacked && "flex flex-col")}>
          <span className="text-[19px] font-700 font-semibold tracking-[-0.03em] text-white">
            XR
          </span>
          {stacked && (
            <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-xr-soft">
              AI Operating System
            </span>
          )}
        </span>
      )}
    </span>
  );
}

export function XrLockup({
  className,
  markSize = 60,
  tagline = true,
}: {
  className?: string;
  markSize?: number;
  tagline?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div className="relative">
        <div
          aria-hidden
          className="absolute -inset-4 rounded-full opacity-70 blur-2xl"
          style={{ background: "radial-gradient(closest-side, rgba(40,226,255,0.45), transparent 70%)" }}
        />
        <XrMark size={markSize} className="relative" />
      </div>
      <div className="flex flex-col">
        <span className="text-[34px] leading-none font-bold tracking-[-0.03em] text-white">
          XR
        </span>
        {tagline && (
          <span className="mt-1.5 text-[12.5px] font-medium text-zinc-400">
            The AI Agent You Can Actually Trust
          </span>
        )}
      </div>
    </div>
  );
}
