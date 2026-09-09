"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { XrMark } from "@/components/Logo";
// Official brand avatar, served from public/brand/ (synced copy of the
// repository asset assets/brand/avatar-hero.png — see public/brand/README.txt).

/**
 * Avatar showcase — official XR brand avatar (assets/brand/avatar-hero.png)
 * presented in a calm premium frame: gradient ring, soft glow, hover tilt.
 * Motion respects prefers-reduced-motion (pure CSS transitions).
 */
export function AvatarShowcase({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hover, setHover] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      setPos({
        x: (e.clientX - r.left) / r.width - 0.5,
        y: (e.clientY - r.top) / r.height - 0.5,
      });
    };
    const onLeave = () => {
      setPos({ x: 0, y: 0 });
      setHover(false);
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const tilt = `perspective(1100px) rotateY(${(pos.x * 7).toFixed(2)}deg) rotateX(${(-pos.y * 7).toFixed(2)}deg)`;

  return (
    <div ref={ref} className={cn("relative h-full w-full select-none", className)}>
      {/* Ambient glow behind the avatar */}
      <div
        aria-hidden
        className="absolute inset-[6%] rounded-full pulse-glow"
        style={{
          filter: "blur(70px)",
          background:
            "radial-gradient(closest-side, rgba(0,212,255,0.30), rgba(96,72,248,0.22) 45%, transparent 72%)",
        }}
      />

      <div
        className="relative h-full w-full transition-transform duration-300 ease-out"
        style={{ transform: tilt, transformStyle: "preserve-3d" }}
      >
        {/* Gradient ring */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-[40px] p-px"
          style={{
            background:
              "linear-gradient(160deg, rgba(0,212,255,0.65), rgba(96,72,248,0.28) 45%, rgba(255,255,255,0.06) 70%, rgba(0,255,136,0.25))",
            boxShadow:
              "0 30px 90px -30px rgba(0,0,0,0.8), 0 0 60px -18px rgba(96,72,248,0.4)",
          }}
        >
          <div
            className={cn(
              "relative h-full w-full overflow-hidden rounded-[40px] bg-[#0a0a0f] transition-shadow duration-300",
              hover && "shadow-[0_0_70px_-10px_rgba(0,212,255,0.35)]"
            )}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
          >
            <Image
              src="/brand/avatar-hero.png"
              alt="The official XR avatar — the agent behind the runtime"
              fill
              priority
              sizes="(max-width: 1024px) 90vw, 45vw"
              className="object-cover"
            />
            {/* Bottom scrim for legible caption */}
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-28"
              style={{ background: "linear-gradient(180deg, transparent, rgba(10,10,15,0.85))" }}
            />
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between p-5">
              <div>
                <div className="flex items-center gap-2">
                  <XrMark size={16} />
                  <span className="text-sm font-semibold text-white">XR</span>
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-400">
                  Local-first agent runtime · v1.0.0 (Truth)
                </div>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-medium text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
                Ready
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
