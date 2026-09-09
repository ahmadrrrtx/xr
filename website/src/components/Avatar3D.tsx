"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * XR Avatar — pure SVG/GLSL-feel 3D orb.
 * Redesigned for XR 4.0: navy background, cyan accent, cleaner look.
 * Interactive lighting follows the cursor.
 */
export function Avatar3D() {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      setPos({ x, y });
    };
    const leave = () => setPos({ x: 0, y: 0 });
    window.addEventListener("mousemove", handle);
    el.addEventListener("mouseleave", leave);
    return () => {
      window.removeEventListener("mousemove", handle);
      el.removeEventListener("mouseleave", leave);
    };
  }, []);

  const rx = pos.y * -12;
  const ry = pos.x * 12;

  return (
    <div
      ref={ref}
      className="relative flex items-center justify-center select-none"
      style={{ width: "100%", height: "100%", perspective: 1000 }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      {/* Ambient glow */}
      <motion.div
        aria-hidden
        className="absolute rounded-full pulse-glow"
        style={{
          width: "80%",
          height: "80%",
          filter: "blur(70px)",
          background:
            "radial-gradient(closest-side, rgba(56,189,248,0.35), rgba(56,189,248,0.1) 45%, transparent 70%)",
        }}
        animate={{ scale: pressed ? 0.96 : 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      />

      {/* Orbit ring */}
      <motion.div
        aria-hidden
        className="absolute rounded-full border border-slate-600/30 float-slow"
        style={{ width: "90%", height: "90%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      />

      {/* The sphere */}
      <motion.div
        aria-hidden
        className="relative rounded-full"
        style={{
          width: "58%",
          height: "58%",
          transformStyle: "preserve-3d",
          transform: `rotateX(${rx}deg) rotateY(${ry}deg) scale(${pressed ? 0.97 : 1})`,
          transition: "transform 0.18s ease-out",
        }}
      >
        {/* Base gradient — deep navy with cyan highlight */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 28%, rgba(56,189,248,0.4), rgba(15,23,42,0.9) 40%, #0B1120 80%)",
            boxShadow:
              "inset -16px -24px 48px rgba(0,0,0,0.6), inset 8px 16px 32px rgba(56,189,248,0.08), 0 30px 60px -15px rgba(56,189,248,0.3)",
          }}
        />
        {/* Specular highlight (cursor-follow) */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 0,
            background: `radial-gradient(circle at ${50 + pos.x * 50}% ${50 + pos.y * 50}%, rgba(56,189,248,0.3), transparent 30%)`,
            mixBlendMode: "screen",
          }}
        />
        {/* Conic shimmer — cyan */}
        <div
          className="absolute inset-0 rounded-full opacity-50"
          style={{
            background:
              "conic-gradient(from 90deg, transparent 0deg, rgba(56,189,248,0.15) 60deg, transparent 120deg, transparent 240deg, rgba(96,72,248,0.1) 300deg, transparent 360deg)",
            mixBlendMode: "screen",
          }}
        />
        {/* XR mark */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-white font-bold tracking-tight"
            style={{
              fontSize: "clamp(32px,6vw,64px)",
              textShadow: "0 2px 24px rgba(56,189,248,0.5)",
              letterSpacing: "-0.04em",
            }}
          >
            XR
          </span>
        </div>
        {/* Soft rim */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            boxShadow: "inset 0 0 0 1px rgba(56,189,248,0.1)",
          }}
        />
      </motion.div>

      {/* Orbiting dots */}
      <motion.div
        aria-hidden
        className="absolute"
        style={{ width: "90%", height: "90%" }}
        animate={{ rotate: -360 }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_20px_4px_rgba(56,189,248,0.6)]" />
      </motion.div>
      <motion.div
        aria-hidden
        className="absolute"
        style={{ width: "106%", height: "106%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 h-1.5 w-1.5 rounded-full bg-slate-400 shadow-[0_0_12px_3px_rgba(148,163,184,0.4)]" />
      </motion.div>
    </div>
  );
}
