"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

/**
 * XR Avatar — pure SVG/GLSL-feel 3D orb.
 * No external three.js dependency (keeps bundle lean / build reliable),
 * but the look is deliberately "floating 3D" with layered gradients,
 * conic highlight, interactive lighting that follows the cursor,
 * and subtle parallax.
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

  const rx = pos.y * -14;
  const ry = pos.x * 14;

  return (
    <div
      ref={ref}
      className="relative flex items-center justify-center select-none"
      style={{ width: "100%", height: "100%", perspective: 1000 }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
    >
      {/* Glow halo */}
      <motion.div
        aria-hidden
        className="absolute rounded-full pulse-glow"
        style={{
          width: "78%",
          height: "78%",
          filter: "blur(60px)",
          background:
            "radial-gradient(closest-side, rgba(124,92,255,0.55), rgba(56,189,248,0.2) 45%, transparent 70%)",
        }}
        animate={{ scale: pressed ? 0.95 : 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      />

      {/* Orbit rings */}
      <motion.div
        aria-hidden
        className="absolute rounded-full border border-white/10 float-slow"
        style={{ width: "92%", height: "92%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
      />
      <motion.div
        aria-hidden
        className="absolute rounded-full border border-white/5"
        style={{ width: "110%", height: "110%", transform: "rotateX(70deg)" }}
      />

      {/* The sphere */}
      <motion.div
        aria-hidden
        className="relative rounded-full"
        style={{
          width: "62%",
          height: "62%",
          transformStyle: "preserve-3d",
          transform: `rotateX(${rx}deg) rotateY(${ry}deg) scale(${pressed ? 0.96 : 1})`,
          transition: "transform 0.18s ease-out",
        }}
      >
        {/* Base gradient */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 30% 28%, rgba(255,255,255,0.9), rgba(180,160,255,0.5) 25%, rgba(60,40,130,0.7) 55%, #0a0a12 85%)",
            boxShadow:
              "inset -20px -30px 60px rgba(0,0,0,0.6), inset 10px 20px 40px rgba(255,255,255,0.08), 0 40px 80px -20px rgba(124,92,255,0.45)",
          }}
        />
        {/* Specular highlight (cursor-follow) */}
        <div
          className="absolute rounded-full"
          style={{
            inset: 0,
            background: `radial-gradient(circle at ${50 + pos.x * 50}% ${50 + pos.y * 50}%, rgba(255,255,255,0.35), transparent 35%)`,
            mixBlendMode: "screen",
          }}
        />
        {/* Conic shimmer */}
        <div
          className="absolute inset-0 rounded-full opacity-60"
          style={{
            background:
              "conic-gradient(from 90deg, transparent 0deg, rgba(255,255,255,0.15) 60deg, transparent 120deg, transparent 240deg, rgba(124,200,255,0.12) 300deg, transparent 360deg)",
            mixBlendMode: "screen",
          }}
        />
        {/* XR mark */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-white font-bold tracking-tight"
            style={{
              fontSize: "clamp(36px,7vw,72px)",
              textShadow: "0 2px 18px rgba(124,92,255,0.6)",
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
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        />
      </motion.div>

      {/* Orbiting dots */}
      <motion.div
        aria-hidden
        className="absolute"
        style={{ width: "92%", height: "92%" }}
        animate={{ rotate: -360 }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 h-2 w-2 rounded-full bg-white shadow-[0_0_20px_4px_rgba(168,146,255,0.7)]" />
      </motion.div>
      <motion.div
        aria-hidden
        className="absolute"
        style={{ width: "110%", height: "110%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 h-1.5 w-1.5 rounded-full bg-sky-300 shadow-[0_0_16px_4px_rgba(56,189,248,0.6)]" />
      </motion.div>
    </div>
  );
}
