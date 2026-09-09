"use client";

import Image from "next/image";
import { motion } from "framer-motion";

/**
 * XR Avatar — uses the official avatar artwork with glow effects.
 * Displays the main avatar with animated ambient glow.
 */
export function AvatarHero({ className }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center select-none ${className ?? ""}`}>
      {/* Ambient glow behind */}
      <motion.div
        aria-hidden
        className="absolute rounded-full"
        style={{
          width: "70%",
          height: "70%",
          filter: "blur(60px)",
          background:
            "radial-gradient(closest-side, rgba(56,189,248,0.4), rgba(56,189,248,0.1) 50%, transparent 70%)",
        }}
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* Orbit ring */}
      <motion.div
        aria-hidden
        className="absolute rounded-full border border-cyan-500/10"
        style={{ width: "85%", height: "85%" }}
        animate={{ rotate: 360 }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-cyan-400 shadow-[0_0_12px_3px_rgba(56,189,248,0.6)]" />
      </motion.div>

      {/* Outer orbit */}
      <motion.div
        aria-hidden
        className="absolute rounded-full border border-slate-600/20"
        style={{ width: "95%", height: "95%" }}
        animate={{ rotate: -360 }}
        transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
      >
        <span className="absolute top-1/2 -right-1 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-slate-400 shadow-[0_0_8px_2px_rgba(148,163,184,0.4)]" />
      </motion.div>

      {/* Main avatar image */}
      <motion.div
        className="relative z-10"
        style={{ width: "75%", height: "75%" }}
        animate={{
          y: [0, -8, 0],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <Image
          src="/images/avatar.png"
          alt="XR AI Companion"
          fill
          className="object-contain drop-shadow-[0_0_40px_rgba(56,189,248,0.3)]"
          priority
        />
      </motion.div>
    </div>
  );
}

/**
 * Compact avatar for smaller contexts (nav, cards).
 */
export function AvatarCompact({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <div
      className={`relative rounded-full overflow-hidden border border-cyan-500/20 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/images/avatar-side.png"
        alt="XR"
        fill
        className="object-cover"
      />
    </div>
  );
}
