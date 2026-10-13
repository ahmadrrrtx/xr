import { cn } from "@/lib/utils";

/**
 * The XR mark.
 *
 * Two tones, and the reason there are two rather than one:
 *
 *   · `violet` is the original marketing gradient and stays the default, which
 *     is what keeps every existing page in Phases 0–29 looking exactly as it did.
 *   · `cyan` is the Phase 30 brand treatment — the same mark in the runtime's
 *     accent, for the surfaces introduced with the Business tier (auth, console).
 *
 * The gradient id is per-tone because SVG ids are document-global: two logos with
 * the same id means the second one references the first one's paint, which shows
 * up as a violet mark on a cyan page and is maddening to debug.
 */
export function XrLogo({
  className,
  size = 22,
  tone = "violet",
}: {
  className?: string;
  size?: number;
  tone?: "violet" | "cyan";
}) {
  const id = tone === "cyan" ? "xrg-cyan" : "xrg";
  const stops =
    tone === "cyan"
      ? [
          { offset: "0", color: "#7df3ff" },
          { offset: "0.5", color: "#eaffff" },
          { offset: "1", color: "#00a8bf" },
        ]
      : [
          { offset: "0", color: "#a892ff" },
          { offset: "0.5", color: "#ffffff" },
          { offset: "1", color: "#7cc8ff" },
        ];
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)} aria-label="XR">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            {stops.map((stop) => (
              <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="8"
          fill={tone === "cyan" ? "#03070d" : "#0b0b0f"}
          stroke={`url(#${id})`}
          strokeOpacity="0.6"
        />
        <path
          d="M9 10 L14 16 L9 22 H11.5 L15.2 17.6 L17.8 22 H23 L18 16 L22.5 10 H20 L16.6 14.4 L14 10 Z"
          fill={`url(#${id})`}
        />
      </svg>
      <span className="text-[15px]">XR</span>
    </span>
  );
}
