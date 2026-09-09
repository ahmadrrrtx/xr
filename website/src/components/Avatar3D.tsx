"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";

/**
 * XR Avatar — official brand visual.
 *
 * Uses the repository's official avatar image (assets/brand/avatar-front.png)
 * presented as a floating, glowing "agent presence" — a soft light halo, a
 * tilt-on-cursor parallax, and a subtle entrance. No fake 3D orb or invented
 * identity: this is the official XR avatar, framed to feel premium and calm.
 */
export function Avatar3D() {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 120, damping: 24 });
  const sy = useSpring(my, { stiffness: 120, damping: 24 });

  const rotateY = useTransform(sx, [0, 1], [-8, 8]);
  const rotateX = useTransform(sy, [0, 1], [8, -8]);

  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      mx.set((e.clientX - r.left) / r.width);
      my.set((e.clientY - r.top) / r.height);
    };
    const leave = () => {
      mx.set(0.5);
      my.set(0.5);
    };
    window.addEventListener("mousemove", handle);
    el.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", handle);
      el.removeEventListener("mouseleave", leave);
    };
  }, [mx, my]);

  return (
    <div className="relative flex items-center justify-center select-none" style={{ perspective: 1000 }}>
      {/* Halo glow */}
      <motion.div
        aria-hidden
        className="absolute rounded-full"
        style={{
          width: "84%",
          height: "84%",
          filter: "blur(70px)",
          background:
            "radial-gradient(closest-side, rgba(40,180,255,0.5), rgba(84,111,255,0.22) 45%, transparent 72%)",
        }}
        animate={{ scale: pressed ? 0.95 : 1, opacity: [0.75, 0.95, 0.75] }}
        transition={{ scale: { type: "spring", stiffness: 180, damping: 20 }, opacity: { duration: 6, repeat: Infinity } }}
      />

      {/* Orbiting accent dot */}
      <motion.div
        aria-hidden
        className="absolute rounded-full"
        style={{ width: "96%", height: "96%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 h-2 w-2 rounded-full bg-cyan shadow-[0_0_18px_4px_rgba(40,226,255,0.6)]" />
      </motion.div>

      {/* The official avatar */}
      <motion.div
        className="relative w-full max-w-[520px]"
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
          scale: pressed ? 0.985 : 1,
        }}
        transition={{ type: "spring", stiffness: 160, damping: 22 }}
      >
        <div
          className="relative overflow-hidden rounded-[28px]"
          style={{
            boxShadow:
              "0 40px 120px -30px rgba(40,180,255,0.5), 0 14px 60px -14px rgba(84,111,255,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/avatar-front.png"
            alt="XR — the trusted AI agent"
            className="block w-full h-auto object-cover"
            draggable={false}
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onMouseLeave={() => setPressed(false)}
            loading="eager"
          />
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, rgba(5,6,10,0) 55%, rgba(5,6,10,0.55) 100%)",
            }}
          />
        </div>

        {/* Floating caption chip */}
        <motion.div
          className="absolute -bottom-4 left-1/2 -translate-x-1/2 glass rounded-2xl px-4 py-2.5 flex items-center gap-2.5"
          style={{ boxShadow: "0 18px 50px -16px rgba(0,0,0,0.7)" }}
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.7)]" />
          <div className="text-left">
            <div className="text-[12.5px] font-semibold text-white leading-none">XR is online</div>
            <div className="text-[10.5px] text-zinc-400 mt-0.5">Local-first · BYOK · Sandboxed</div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
