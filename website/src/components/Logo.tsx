import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * The XR mark (Phase 31 · Bucket F v2) — Ahmad's delivered emblem:
 * curved silver blades, tilted orbital ring, cyan core. Renders the
 * 512px emblem master from /public; the `tone` prop is retained for
 * call-site compatibility (the v2 mark is single-tone).
 */
export function XrLogo({
  className,
  size = 22,
}: {
  className?: string;
  size?: number;
  tone?: "violet" | "cyan";
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}
      aria-label="XR"
    >
      <Image
        src="/xr-emblem.png"
        alt=""
        width={size}
        height={size}
        aria-hidden="true"
        priority={false}
      />
      XR
    </span>
  );
}
