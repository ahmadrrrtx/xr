import { cn } from "@/lib/utils";

export function XrLogo({ className, size = 22 }: { className?: string; size?: number }) {
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
          <linearGradient id="xrg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#a892ff" />
            <stop offset="0.5" stopColor="#ffffff" />
            <stop offset="1" stopColor="#7cc8ff" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#0b0b0f" stroke="url(#xrg)" strokeOpacity="0.6" />
        <path
          d="M9 10 L14 16 L9 22 H11.5 L15.2 17.6 L17.8 22 H23 L18 16 L22.5 10 H20 L16.6 14.4 L14 10 Z"
          fill="url(#xrg)"
        />
      </svg>
      <span className="text-[15px]">XR</span>
    </span>
  );
}
