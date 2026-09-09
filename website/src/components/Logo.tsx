import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * XR Logo — uses the official brand asset from the repository.
 * Two variants: "full" shows the mark + wordmark (nav, footer),
 * "icon" shows just the symbol (favicon, compact spaces).
 */
export function XrLogo({
  className,
  variant = "full",
  height = 28,
}: {
  className?: string;
  variant?: "full" | "icon";
  height?: number;
}) {
  if (variant === "icon") {
    return (
      <div className={cn("relative", className)} style={{ width: height, height }}>
        <Image
          src="/images/xr-logo.png"
          alt="XR"
          fill
          className="object-contain"
          style={{ objectPosition: "left center" }}
          priority
        />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative shrink-0" style={{ width: height + 4, height: height + 4 }}>
        <Image
          src="/images/xr-logo.png"
          alt="XR"
          fill
          className="object-contain"
          style={{ objectPosition: "left center" }}
          priority
        />
      </div>
    </div>
  );
}
