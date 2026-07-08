"use client";

import { motion, useScroll, useTransform, useInView, AnimatePresence } from "framer-motion";
import { useState, useEffect, useRef } from "react";
import {
  ChevronDown,
  Github,
  Terminal,
  Shield,
  Zap,
  Lock,
  Eye,
  Mic,
  Cpu,
  Database,
  Globe,
  Bot,
  HardDrive,
  MessageSquare,
  RefreshCcw,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  Star,
  ChevronRight,
  Play,
  TrendingDown,
  Fingerprint,
  Layers,
  Volume2,
  Code2,
  Server,
  Smartphone,
  Monitor,
  Terminal as TerminalIcon,
  LucideIcon,
  ShieldCheck,
  TrendingUp,
  Layers3,
  Search,
} from "lucide-react";

// ─── Animation Helpers ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
};

const scaleIn = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

// ─── Animated Counter ─────────────────────────────────────────────────────────

function AnimatedCounter({
  target,
  suffix = "",
  prefix = "",
  duration = 2000,
}: {
  target: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
}) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [inView, target, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {count}
      {suffix}
    </span>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-white/5 border border-white/10"
      style={{ color: copied ? "#00FF88" : "#94A3B8" }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const navLinks = [
    { label: "Features", href: "#features" },
    { label: "Marketplace", href: "/marketplace" },
    { label: "Comparison", href: "#comparison" },
    { label: "Providers", href: "#providers" },
    { label: "Install", href: "#install" },
    { label: "Security", href: "#security" },
    { label: "FAQ", href: "#faq" },
  ];

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          background: scrolled ? "rgba(2, 8, 23, 0.85)" : "transparent",
          backdropFilter: scrolled ? "blur(20px)" : "none",
          borderBottom: scrolled ? "1px solid rgba(0, 212, 255, 0.08)" : "none",
        }}
      >
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          {/* Logo */}
          <a href="#" className="flex items-center gap-3 group">
            <img
              src="/logo.png"
              alt="XR"
              className="h-8 w-8 object-contain"
            />
            <span className="font-syne font-bold text-lg text-xr-text group-hover:text-xr-cyan transition-colors">
              XR
            </span>
          </a>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="nav-link text-sm">
                {link.label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-4">
            <a
              href="/marketplace"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all bg-xr-cyan text-black hover:shadow-[0_0_28px_rgba(0,212,255,0.35)]"
            >
              Marketplace
            </a>
            <a
              href="https://github.com/ahmadrrrtx/xr"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all"
              style={{
                borderColor: "rgba(0, 212, 255, 0.3)",
                color: "#00D4FF",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
                e.currentTarget.style.borderColor = "#00D4FF";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.3)";
              }}
            >
              <Github size={16} />
              GitHub
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            className="md:hidden p-2 rounded-lg"
            style={{ color: "#94A3B8" }}
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden border-t overflow-hidden"
              style={{ background: "rgba(2, 8, 23, 0.95)", borderColor: "rgba(0, 212, 255, 0.08)" }}
            >
              <div className="px-6 py-4 space-y-3">
                {navLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="block py-2 text-sm font-medium"
                    style={{ color: "#94A3B8" }}
                    onClick={() => setMobileOpen(false)}
                  >
                    {link.label}
                  </a>
                ))}
                <a
                  href="https://github.com/ahmadrrrtx/xr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 py-2 text-sm font-medium"
                  style={{ color: "#00D4FF" }}
                >
                  <Github size={16} />
                  GitHub
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────

function HeroSection() {
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 120]);
  const opacity = useTransform(scrollY, [0, 400], [1, 0]);

  const stats = [
    { value: "$0", label: "To Run (Local + Free Cloud)", color: "#00FF88" },
    { value: "12", label: "AI Providers", color: "#00D4FF" },
    { value: "124", label: "Tests Passing", color: "#00D4FF" },
    { value: "4", label: "OS Supported", color: "#F59E0B" },
  ];

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden grid-bg pt-16">
      {/* Radial glow */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0, 212, 255, 0.12), transparent)",
        }}
      />

      {/* Content */}
      <motion.div
        style={{ y, opacity }}
        className="relative z-10 max-w-5xl mx-auto px-6 text-center"
      >
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="inline-flex items-center gap-2 mb-8"
        >
          <span className="badge">
            <span style={{ color: "#00FF88" }}>⚡</span>
            v0.5 Local Model Intelligence · MIT Licensed
          </span>
        </motion.div>

        {/* Avatar */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex items-center justify-center mb-10"
        >
          {/* Rotating rings */}
          <div
            className="absolute w-52 h-52 rounded-full border-t-2 border-r-2"
            style={{
              borderColor: "rgba(0, 212, 255, 0.5)",
              animation: "spin 8s linear infinite",
            }}
          />
          <div
            className="absolute w-72 h-72 rounded-full border-b-2 border-l-2"
            style={{
              borderColor: "rgba(0, 255, 136, 0.25)",
              animation: "spin 12s linear infinite reverse",
            }}
          />
          <div
            className="absolute w-96 h-96 rounded-full border-t border-r"
            style={{
              borderColor: "rgba(0, 212, 255, 0.08)",
              animation: "spin 20s linear infinite",
            }}
          />

          {/* Glow behind avatar */}
          <div
            className="absolute w-52 h-52 rounded-full"
            style={{
              background: "radial-gradient(circle, rgba(0, 212, 255, 0.15) 0%, transparent 70%)",
              filter: "blur(20px)",
            }}
          />

          {/* Avatar image */}
          <motion.img
            src="/avatar.png"
            alt="XR — Cybernetic Guardian"
            className="relative w-48 h-48 object-contain rounded-full z-10"
            style={{
              filter: "drop-shadow(0 0 30px rgba(0, 212, 255, 0.4))",
            }}
            whileHover={{ scale: 1.05 }}
            transition={{ duration: 0.3 }}
          />
        </motion.div>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="font-syne font-800 text-5xl md:text-7xl font-bold leading-tight mb-6"
        >
          The AI Agent You
          <br />
          <span className="text-gradient-cyan">Can Actually Trust</span>
        </motion.h1>

        {/* Subheadline */}
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-lg md:text-xl max-w-2xl mx-auto mb-10"
          style={{ color: "#94A3B8" }}
        >
          <strong style={{ color: "#F8FAFC" }}>
            Local model auto-detection · BYOK cloud fallback · Hard spend ceiling
          </strong>
          <br />
          Ollama local mode · Hybrid routing · Tamper-evident audit
        </motion.p>

        {/* BYOK tagline */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-base font-medium mb-10"
          style={{ color: "#00D4FF" }}
        >
          Local-first + BYOK — use no key, or bring your own.
        </motion.p>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12 max-w-3xl mx-auto"
        >
          {stats.map((stat, i) => (
            <div key={i} className="stat-card glass-card">
              <div className="text-2xl font-bold font-syne" style={{ color: stat.color }}>
                <AnimatedCounter target={parseInt(stat.value.replace(/[^0-9]/g, ""))} suffix={stat.value.includes("$") ? "" : stat.value.includes("12") || stat.value.includes("4") || stat.value.includes("124") ? "" : ""} prefix={stat.value.includes("$") ? "$" : ""} />
              </div>
              <div className="text-xs mt-1" style={{ color: "#64748B" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* CTA Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <a href="#install" className="btn-primary font-syne">
            <Zap size={18} />
            Install Now — Free
          </a>
          <a
            href="https://github.com/ahmadrrrtx/xr"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary font-syne"
          >
            <Github size={18} />
            View on GitHub
          </a>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-16 flex flex-col items-center gap-2"
          style={{ color: "#475569" }}
        >
          <span className="text-xs tracking-wider uppercase">Scroll to explore</span>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronDown size={20} />
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none"
        style={{
          background: "linear-gradient(to bottom, transparent, #020817)",
        }}
      />
    </section>
  );
}

// ─── Comparison Table ─────────────────────────────────────────────────────────

function ComparisonSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const features = [
    { name: "One-command install", xr: true, claude: true, openclaw: true, hermes: true },
    { name: "Full TUI (slash commands, history)", xr: true, claude: true, openclaw: "partial", hermes: true },
    { name: "JARVIS computer control (screenshots)", xr: true, claude: false, openclaw: false, hermes: false },
    { name: "System control (volume, clipboard, apps)", xr: true, claude: false, openclaw: "partial", hermes: "partial" },
    { name: "Hard spend ceiling (code-enforced)", xr: true, claude: false, openclaw: false, hermes: false },
    { name: "Tamper-evident audit log (SHA-256 chain)", xr: true, claude: false, openclaw: false, hermes: false },
    { name: "Injection benchmark (runnable block-rate)", xr: true, claude: false, openclaw: false, hermes: false },
    { name: "Egress allow-list (anti-exfil)", xr: true, claude: false, openclaw: false, hermes: "partial" },
    { name: "Non-regressive skills (auto-rollback)", xr: true, claude: false, openclaw: false, hermes: true },
    { name: "Self-improving (learns from experience)", xr: true, claude: false, openclaw: false, hermes: true },
    { name: "Docker sandbox for shell commands", xr: true, claude: false, openclaw: "partial", hermes: true },
    { name: "Voice control (wake word → STT → TTS)", xr: true, claude: false, openclaw: true, hermes: true },
    { name: "Research mode (source-first, citation-aware)", xr: true, claude: "partial", openclaw: false, hermes: false },
    { name: "Permission-based plugin ecosystem (sandboxed)", xr: true, claude: false, openclaw: "partial", hermes: false },
    { name: "BYOK + $0 to run", xr: true, claude: false, openclaw: "partial", hermes: true },
    { name: "Cross-platform (Win/Mac/Linux/Termux)", xr: true, claude: true, openclaw: true, hermes: true },
  ];

  const Cell = ({ value }: { value: boolean | string }) => {
    if (value === true)
      return (
        <CheckCircle2 size={20} className="mx-auto" style={{ color: "#00FF88" }} />
      );
    if (value === false)
      return <XCircle size={20} className="mx-auto" style={{ color: "#475569" }} />;
    return (
      <span className="text-xs font-medium text-center" style={{ color: "#F59E0B" }}>
        {value as string}
      </span>
    );
  };

  return (
    <section id="comparison" className="py-24 relative" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-16"
        >
          <span className="section-label">
            <Layers3 size={14} />
            Comparison
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            Why XR <span className="text-gradient-cyan">wins</span>
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: "#94A3B8" }}>
            Built for trust. Features the competition doesn&apos;t even attempt.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="overflow-x-auto"
        >
          <div className="min-w-[640px]">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(0, 212, 255, 0.1)" }}>
                  <th className="text-left py-4 px-4 font-syne font-semibold text-sm" style={{ color: "#94A3B8" }}>
                    Feature
                  </th>
                  {["XR", "Claude Code", "OpenClaw", "Hermes"].map((name, i) => (
                    <th
                      key={name}
                      className="py-4 px-4 text-center font-syne font-bold text-sm"
                      style={{
                        color: i === 0 ? "#00D4FF" : "#94A3B8",
                        borderLeft: i === 0 ? "1px solid rgba(0, 212, 255, 0.15)" : "none",
                      }}
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {features.map((row, i) => (
                  <motion.tr
                    key={row.name}
                    initial={{ opacity: 0, x: -20 }}
                    animate={inView ? { opacity: 1, x: 0 } : {}}
                    transition={{ delay: 0.1 * i }}
                    className="compare-row"
                    style={{
                      borderBottom: "1px solid rgba(0, 212, 255, 0.04)",
                    }}
                  >
                    <td className="py-3 px-4 text-sm" style={{ color: "#CBD5E1" }}>
                      {row.name}
                    </td>
                    <td className="py-3 px-4 text-center" style={{ borderLeft: "1px solid rgba(0, 212, 255, 0.1)" }}>
                      <Cell value={row.xr} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Cell value={row.claude} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Cell value={row.openclaw} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Cell value={row.hermes} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Core Pillars ─────────────────────────────────────────────────────────────

function PillarsSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const pillars = [
    {
      icon: Lock,
      color: "#00D4FF",
      bg: "rgba(0, 212, 255, 0.08)",
      title: "Local-first + BYOK",
      tagline: "No key required for local mode.",
      description:
        "XR runs on your local Ollama model or your provider API key. v0.5 detects RAM/VRAM/CPU/disk, recommends a model, downloads it with approval, and keeps cloud fallback deterministic.",
      highlight: "$0 to trust",
    },
    {
      icon: Eye,
      color: "#00FF88",
      bg: "rgba(0, 255, 136, 0.08)",
      title: "JARVIS-Level Control",
      tagline: "It sees your screen.",
      description:
        "XR takes screenshots, reasons about what's on screen, and takes actions — click, type, scroll, open apps — just like you would. The difference between asking and showing.",
      highlight: "Computer vision + action",
    },
    {
      icon: TrendingDown,
      color: "#F59E0B",
      bg: "rgba(245, 158, 11, 0.08)",
      title: "Cost Governor",
      tagline: "Enforced in code.",
      description:
        "The agent literally cannot exceed your budget. checkBeforeStep() runs before every model call and blocks if the next step would breach the ceiling. Not a suggestion.",
      highlight: "Code-enforced ceiling",
    },
    {
      icon: ShieldCheck,
      color: "#A855F7",
      bg: "rgba(168, 85, 247, 0.08)",
      title: "Tamper-Evident Audit",
      tagline: "SHA-256 hash chain.",
      description:
        "Every action logged with SHA-256 hash chain. Verify integrity with xr verify-log. Any tampering is detected and reported. Redacts API keys before storage.",
      highlight: "Git's trick, $0, offline",
    },
  ];

  return (
    <section className="py-24 relative" ref={ref}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(0, 212, 255, 0.04), transparent)",
        }}
      />
      <div className="max-w-7xl mx-auto px-6 relative">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-16"
        >
          <span className="section-label">
            <Zap size={14} />
            Core Pillars
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            What makes XR <span className="text-gradient-cyan">different</span>
          </h2>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
        >
          {pillars.map((pillar, i) => (
            <motion.div
              key={pillar.title}
              variants={fadeUp}
              className="glass-card p-8 group cursor-default"
            >
              {/* Icon + color bar */}
              <div className="flex items-start gap-4 mb-6">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: pillar.bg }}
                >
                  <pillar.icon size={28} style={{ color: pillar.color }} />
                </div>
                <div>
                  <h3 className="font-syne font-bold text-xl mb-1" style={{ color: "#F8FAFC" }}>
                    {pillar.title}
                  </h3>
                  <p className="text-sm font-medium" style={{ color: pillar.color }}>
                    {pillar.tagline}
                  </p>
                </div>
              </div>

              <p className="text-sm leading-relaxed mb-5" style={{ color: "#94A3B8" }}>
                {pillar.description}
              </p>

              <span
                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full"
                style={{
                  background: pillar.bg,
                  color: pillar.color,
                  border: `1px solid ${pillar.color}30`,
                }}
              >
                <CheckCircle2 size={12} />
                {pillar.highlight}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Features Grid ────────────────────────────────────────────────────────────

function FeaturesSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const features = [
    {
      icon: TerminalIcon,
      color: "#00D4FF",
      title: "Shell & Docker Sandbox",
      description: "Every shell command runs in isolated Docker containers. Zero risk of accidental system damage.",
    },
    {
      icon: Database,
      color: "#00FF88",
      title: "Durable Memory (v0.9)",
      description: "Remembers your preferences, projects, and facts — only what you explicitly ask. Local-first, inspectable, editable, and deletable. No silent capture.",
    },
    {
      icon: Mic,
      color: "#F59E0B",
      title: "Voice Control",
      description: "Wake word → speech-to-text → model → text-to-speech. Works on macOS (say command) and Windows (SAPI).",
    },
    {
      icon: Search,
      color: "#22D3EE",
      title: "Research Mode (v0.7)",
      description:
        "Source-first, citation-aware research. XR plans, searches, ranks sources by trust, fetches pages, extracts cited evidence, flags contradictions, and exports a signed report. Never fakes a source or fakes certainty.",
    },
    {
      icon: Globe,
      color: "#A855F7",
      title: "Multi-Provider Support",
      description: "Ollama, Claude, GPT, Gemini, Mistral, DeepSeek, Cerebras, OpenRouter, Groq, Together, Cohere, and Bedrock — swap anytime.",
    },
    {
      icon: Eye,
      color: "#EC4899",
      title: "Computer Vision",
      description: "Screenshots + vision-capable models = XR sees what's on your screen and acts accordingly.",
    },
    {
      icon: RefreshCcw,
      color: "#06B6D4",
      title: "Self-Improving Skills",
      description: "Successful tasks are frozen as immutable skill baselines. Auto-rollback if a skill regresses.",
    },
    {
      icon: Shield,
      color: "#EF4444",
      title: "Injection Defense",
      description: "10-attack corpus benchmark. SHA-256 signed block-rate report. Real numbers, not marketing.",
    },
    {
      icon: HardDrive,
      color: "#84CC16",
      title: "Egress Allow-List",
      description: "Anti-exfiltration controls. Only configured domains can receive data from XR.",
    },
    {
      icon: Monitor,
      color: "#8B5CF6",
      title: "Cross-Platform",
      description: "Linux, macOS, Windows, Android (Termux). One install script. Works everywhere.",
    },
    {
      icon: Bot,
      color: "#F97316",
      title: "Interactive TUI",
      description: "Full terminal UI with slash commands, history, and context. Claude Code-style experience.",
    },
    {
      icon: Layers3,
      color: "#22C55E",
      title: "Plugin Ecosystem",
      description: "Permission-based, sandboxed, audited plugins. Capabilities only for what you grant — never bypassing budget, egress, memory, or security.",
    },
    {
      icon: MessageSquare,
      color: "#14B8A6",
      title: "Telegram Bot",
      description: "Control XR from your phone via Telegram. Same agent, same memory, any device.",
    },
    {
      icon: Code2,
      color: "#6366F1",
      title: "Auto-Rollback",
      description: "Skills that break are automatically rolled back to the last known good version.",
    },
  ];

  return (
    <section id="features" className="py-24 relative" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-16"
        >
          <span className="section-label">
            <Cpu size={14} />
            Features
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            Everything you need.
            <br />
            <span className="text-gradient-cyan">Nothing you don&apos;t.</span>
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: "#94A3B8" }}>
            Built for developers and power users who want real control over their AI agent.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              variants={fadeUp}
              className="glass-card p-6 group cursor-default"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                style={{
                  background: `${feature.color}15`,
                  border: `1px solid ${feature.color}20`,
                }}
              >
                <feature.icon size={22} style={{ color: feature.color }} />
              </div>
              <h3 className="font-syne font-semibold text-base mb-2" style={{ color: "#F1F5F9" }}>
                {feature.title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: "#64748B" }}>
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Providers Section ────────────────────────────────────────────────────────

function ProvidersSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const providers = [
    { name: "Ollama Local", short: "Ollama", color: "#8000FF" },
    { name: "Anthropic Claude", short: "Claude", color: "#FF6B6B" },
    { name: "OpenAI", short: "OpenAI", color: "#10A37F" },
    { name: "Google Gemini", short: "Gemini", color: "#4285F4" },
    { name: "Groq", short: "Groq", color: "#00E676" },
    { name: "DeepSeek", short: "DeepSeek", color: "#0066FF" },
    { name: "Together AI", short: "Together", color: "#9333EA" },
    { name: "OpenRouter", short: "Router", color: "#00D4FF" },
    { name: "Cerebras", short: "Cerebras", color: "#00AAFF" },
    { name: "Mistral AI", short: "Mistral", color: "#FF500F" },
    { name: "Cohere", short: "Cohere", color: "#14B8A6" },
    { name: "AWS Bedrock", short: "Bedrock", color: "#F59E0B" },
  ];

  return (
    <section id="providers" className="py-24 relative" ref={ref}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(0, 255, 136, 0.03), transparent)",
        }}
      />
      <div className="max-w-7xl mx-auto px-6 relative">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-16"
        >
          <span className="section-label">
            <Server size={14} />
            Providers
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            Use <span className="text-gradient-cyan">any model</span>
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: "#94A3B8" }}>
            Ollama local models plus supported BYOK cloud providers. Swap anytime with one command.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
        >
          {providers.map((provider, i) => (
            <motion.div
              key={provider.name}
              variants={scaleIn}
              className="provider-logo text-center"
            >
              <div
                className="w-10 h-10 rounded-lg mx-auto mb-2 flex items-center justify-center font-bold text-sm font-syne"
                style={{
                  background: `${provider.color}20`,
                  color: provider.color,
                  border: `1px solid ${provider.color}30`,
                }}
              >
                {provider.short.charAt(0)}
              </div>
              <span className="text-xs font-medium" style={{ color: "#94A3B8" }}>
                {provider.short}
              </span>
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.4 }}
          className="text-center text-sm mt-8"
          style={{ color: "#475569" }}
        >
          Plus: provider base URL overrides for OpenAI-compatible services and any valid Ollama model ID.
        </motion.p>
      </div>
    </section>
  );
}

// ─── Install Section ───────────────────────────────────────────────────────────

function InstallSection() {
  const [activeOS, setActiveOS] = useState("linux");
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const osOptions = [
    { id: "linux", name: "Linux", icon: Monitor },
    { id: "macos", name: "macOS", icon: Monitor },
    { id: "windows", name: "Windows", icon: Monitor },
    { id: "termux", name: "Termux", icon: Smartphone },
  ];

  const installData = {
    linux: {
      label: "Linux",
      commands: [
        { text: "# One command. Any OS. That's it.", type: "comment" },
        { text: 'curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash', type: "command" },
        { text: "", type: "blank" },
        { text: "# First run: choose Local-only or Hybrid", type: "comment" },
        { text: "xr onboarding", type: "command" },
        { text: "xr models recommend", type: "command" },
        { text: 'xr "hello, who are you"', type: "command" },
        { text: "", type: "blank" },
        { text: "# Interactive TUI (Claude Code-style)", type: "comment" },
        { text: "xr --tui", type: "command" },
        { text: "", type: "blank" },
        { text: "# JARVIS GUI automation", type: "comment" },
        { text: 'xr --computer "open browser and search for AI agents"', type: "command" },
        { text: "", type: "blank" },
        { text: "# Safe computer control (v0.8) — deterministic, opt-in, audited", type: "comment" },
        { text: "xr control start", type: "command" },
        { text: 'xr control open "https://github.com/ahmadrrrtx/xr"', type: "command" },
        { text: 'xr control test            # dry-runs a plan — executes nothing', type: "command" },
        { text: "", type: "blank" },
        { text: "# Durable memory (v0.9) — remembers only what you ask", type: "comment" },
        { text: 'xr memory add "I prefer TypeScript and Bun" --category preference', type: "command" },
        { text: 'xr memory list             # inspect everything · edit/remove anytime', type: "command" },
        { text: "", type: "blank" },
        { text: "# Plugins (1.0) — permission-based, sandboxed, audited", type: "comment" },
        { text: "xr plugins install ./plugins/github   # shows permissions, asks first", type: "command" },
        { text: "xr plugins enable github              # explicit, conscious step", type: "command" },
        { text: "xr plugin github repo ahmadrrrtx/xr   # run a plugin command", type: "command" },
        { text: "", type: "blank" },
        { text: "# Hard budget ceiling — literally cannot exceed", type: "comment" },
        { text: "xr --budget 0.25 \"build a full REST API\"", type: "command" },
      ],
      optional: [
        { text: "# Optional: Free local AI with Ollama", type: "comment" },
        { text: "curl -fsSL https://ollama.ai/install.sh | bash", type: "command" },
        { text: "xr models install", type: "command" },
        { text: "xr models test", type: "command" },
      ],
      note: "Works on Ubuntu, Debian, Fedora, Arch, and more.",
    },
    macos: {
      label: "macOS",
      commands: [
        { text: "# One command. That's it.", type: "comment" },
        { text: 'curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash', type: "command" },
        { text: "", type: "blank" },
        { text: "# Voice works out of the box with \"say\" command!", type: "comment" },
        { text: "xr --voice # Check voice stack", type: "command" },
        { text: "", type: "blank" },
        { text: "# Interactive TUI", type: "comment" },
        { text: "xr --tui", type: "command" },
        { text: "", type: "blank" },
        { text: "# Optional: Free local AI", type: "comment" },
        { text: "brew install ollama", type: "command" },
        { text: "xr models install", type: "command" },
      ],
      optional: [],
      note: "Works on Intel and Apple Silicon Macs. Voice TTS uses built-in \"say\".",
    },
    windows: {
      label: "Windows",
      commands: [
        { text: "# PowerShell (as Administrator)", type: "comment" },
        { text: 'iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)', type: "command" },
        { text: "", type: "blank" },
        { text: "# Then:", type: "comment" },
        { text: "xr doctor # Check system health", type: "command" },
        { text: "xr providers # See all AI providers", type: "command" },
        { text: "", type: "blank" },
        { text: "# Optional: Ollama", type: "comment" },
        { text: "irm https://ollama.com/install.ps1 | iex", type: "command" },
        { text: "xr models install", type: "command" },
      ],
      optional: [],
      note: "PowerShell 5.1+. Voice TTS uses built-in SAPI.",
    },
    termux: {
      label: "Termux",
      commands: [
        { text: "# Install Bun", type: "comment" },
        { text: "pkg install bun", type: "command" },
        { text: "", type: "blank" },
        { text: "# Clone and install", type: "comment" },
        { text: "pkg install git", type: "command" },
        { text: "git clone https://github.com/ahmadrrrtx/xr ~/xr", type: "command" },
        { text: "cd ~/xr && bun install", type: "command" },
        { text: "", type: "blank" },
        { text: "# Run", type: "comment" },
        { text: "bun run src/index.ts doctor", type: "command" },
      ],
      optional: [],
      note: "Works on Android without root! Run XR on your phone.",
    },
  };

  const current = installData[activeOS as keyof typeof installData];

  return (
    <section id="install" className="py-24 relative" ref={ref}>
      <div className="max-w-4xl mx-auto px-6">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-12"
        >
          <span className="section-label">
            <Play size={14} />
            Quick Start
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            Install in <span className="text-gradient-cyan">30 seconds</span>
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: "#94A3B8" }}>
            One command. Any OS. No credit card. No vendor lock-in.
          </p>
        </motion.div>

        {/* OS Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2 }}
          className="flex gap-2 mb-6 flex-wrap"
        >
          {osOptions.map((os) => (
            <button
              key={os.id}
              onClick={() => setActiveOS(os.id)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold font-syne transition-all"
              style={{
                background: activeOS === os.id ? "#00D4FF" : "rgba(15, 23, 42, 0.8)",
                color: activeOS === os.id ? "#020817" : "#94A3B8",
                border: `1px solid ${activeOS === os.id ? "#00D4FF" : "rgba(0, 212, 255, 0.15)"}`,
              }}
            >
              <os.icon size={15} />
              {os.name}
            </button>
          ))}
        </motion.div>

        {/* Terminal */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.3 }}
          className="terminal"
        >
          <div className="terminal-header">
            <div className="terminal-dot" style={{ background: "#EF4444" }} />
            <div className="terminal-dot" style={{ background: "#F59E0B" }} />
            <div className="terminal-dot" style={{ background: "#22C55E" }} />
            <span className="ml-3 text-xs font-medium" style={{ color: "#64748B" }}>
              {current.label} Terminal
            </span>
            <CopyButton
              text={current.commands
                .filter((c) => c.type !== "blank")
                .map((c) => c.text)
                .join("\n")}
            />
          </div>
          <div className="terminal-body">
            {current.commands.map((line, i) => (
              <div key={i}>
                {line.type === "comment" && (
                  <span style={{ color: "#475569" }}>{line.text}</span>
                )}
                {line.type === "command" && (
                  <div className="flex items-center gap-2">
                    <span style={{ color: "#00D4FF" }}>$</span>
                    <span style={{ color: "#E2E8F0" }}>{line.text}</span>
                  </div>
                )}
                {line.type === "blank" && <br />}
              </div>
            ))}

            {current.optional.length > 0 && (
              <>
                <div className="mt-4 mb-2" style={{ color: "#475569" }}>
                  # Optional: Free Local AI
                </div>
                {current.optional.map((line, i) => (
                  <div key={i}>
                    {line.type === "comment" && (
                      <span style={{ color: "#475569" }}>{line.text}</span>
                    )}
                    {line.type === "command" && (
                      <div className="flex items-center gap-2">
                        <span style={{ color: "#00D4FF" }}>$</span>
                        <span style={{ color: "#00FF88" }}>{line.text}</span>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.4 }}
          className="text-center text-sm mt-4"
          style={{ color: "#475569" }}
        >
          {current.note}
        </motion.p>
      </div>
    </section>
  );
}

// ─── Security Section ─────────────────────────────────────────────────────────

function SecuritySection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="security" className="py-24 relative" ref={ref}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(168, 85, 247, 0.04), transparent)",
        }}
      />
      <div className="max-w-7xl mx-auto px-6 relative">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-16"
        >
          <span className="section-label">
            <ShieldCheck size={14} />
            Security
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            Trust is <span className="text-gradient-cyan">built in</span>
          </h2>
          <p className="text-lg max-w-xl mx-auto" style={{ color: "#94A3B8" }}>
            Not bolted on. Every security feature is code-enforced, not suggested.
          </p>
        </motion.div>

        {/* Security Visual: Audit Chain */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16"
        >
          {/* Audit Chain */}
          <div className="glass-card p-8 md:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(0, 212, 255, 0.1)", border: "1px solid rgba(0, 212, 255, 0.2)" }}
              >
                <Fingerprint size={20} style={{ color: "#00D4FF" }} />
              </div>
              <div>
                <h3 className="font-syne font-bold text-lg" style={{ color: "#F8FAFC" }}>
                  Tamper-Evident Audit Log
                </h3>
                <p className="text-xs" style={{ color: "#64748B" }}>
                  SHA-256 hash chain
                </p>
              </div>
            </div>

            <p className="text-sm mb-6" style={{ color: "#94A3B8" }}>
              Every action XR takes is logged with a SHA-256 hash chain. Verify integrity with a single command. Any tampering is detected instantly.
            </p>

            {/* Visual chain */}
            <div className="flex flex-wrap items-center gap-3">
              {["H(0)", "H(1)", "H(2)", "H(3)", "H(n)"].map((block, i) => (
                <div key={block} className="relative">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={inView ? { opacity: 1, scale: 1 } : {}}
                    transition={{ delay: 0.3 + i * 0.1 }}
                    className="px-4 py-2 rounded-lg text-xs font-mono font-semibold"
                    style={{
                      background: i === 4 ? "rgba(0, 212, 255, 0.15)" : "rgba(15, 23, 42, 0.8)",
                      border: `1px solid ${i === 4 ? "rgba(0, 212, 255, 0.4)" : "rgba(0, 212, 255, 0.15)"}`,
                      color: i === 4 ? "#00D4FF" : "#64748B",
                    }}
                  >
                    {block}
                  </motion.div>
                  {i < 4 && (
                    <span
                      className="absolute -right-5 top-1/2 transform -translate-y-1/2"
                      style={{ color: "#00D4FF", fontSize: "10px" }}
                    >
                      →
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 p-3 rounded-lg" style={{ background: "rgba(0, 255, 136, 0.05)", border: "1px solid rgba(0, 255, 136, 0.1)" }}>
              <code className="text-xs font-mono" style={{ color: "#00FF88" }}>
                xr verify-log → "✓ Audit chain intact (N entries)"
              </code>
            </div>
          </div>

          {/* Spend Ceiling */}
          <div className="glass-card p-8">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.2)" }}
              >
                <TrendingDown size={20} style={{ color: "#F59E0B" }} />
              </div>
              <div>
                <h3 className="font-syne font-bold text-lg" style={{ color: "#F8FAFC" }}>
                  Cost Governor
                </h3>
                <p className="text-xs" style={{ color: "#64748B" }}>
                  Hard ceiling
                </p>
              </div>
            </div>

            <p className="text-sm mb-6" style={{ color: "#94A3B8" }}>
              Code-enforced spend limits. The agent literally cannot make a call that exceeds your budget.
            </p>

            {/* Budget meter */}
            <div className="mb-4">
              <div className="flex justify-between text-xs mb-2">
                <span style={{ color: "#64748B" }}>Spent</span>
                <span style={{ color: "#00FF88" }}>$0.12 / $0.25</span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: "rgba(15, 23, 42, 0.8)", border: "1px solid rgba(0, 212, 255, 0.1)" }}>
                <motion.div
                  initial={{ width: "0%" }}
                  animate={inView ? { width: "48%" } : {}}
                  transition={{ duration: 1.5, delay: 0.5, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #00D4FF, #00FF88)",
                    boxShadow: "0 0 10px rgba(0, 212, 255, 0.5)",
                  }}
                />
              </div>
            </div>

            <code className="text-xs font-mono" style={{ color: "#94A3B8" }}>
              xr --budget 0.25 "task"
            </code>
          </div>
        </motion.div>

        {/* Security features row */}
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {[
            { icon: Shield, color: "#00D4FF", title: "Injection Defense", desc: "10-attack benchmark with SHA-256 signed block-rate reports." },
            { icon: HardDrive, color: "#00FF88", title: "Egress Allow-List", desc: "Only configured domains can receive data from XR." },
            { icon: Database, color: "#A855F7", title: "Local-First Data", desc: "All data stored locally. Nothing leaves your infrastructure." },
            { icon: Lock, color: "#F59E0B", title: "API Key Redaction", desc: "Keys are redacted before storage in the audit log." },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              variants={fadeUp}
              className="glass-card p-5"
            >
              <item.icon size={20} style={{ color: item.color }} className="mb-3" />
              <h4 className="font-syne font-semibold text-sm mb-1" style={{ color: "#F1F5F9" }}>
                {item.title}
              </h4>
              <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>
                {item.desc}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Testimonials / Social Proof ─────────────────────────────────────────────

function SocialProofSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const stats = [
    { value: "1", suffix: "", label: "GitHub Star", icon: Star },
    { value: "58", suffix: "+", label: "Commits", icon: TrendingUp },
    { value: "124", suffix: "", label: "Tests Passing", icon: CheckCircle2 },
    { value: "MIT", suffix: "", label: "License", icon: Lock },
  ];

  const quotes = [
    {
      quote: "Finally an agent that actually respects your budget. The cost governor alone is worth switching.",
      author: "Developer on X",
      handle: "@dev_handle",
    },
    {
      quote: "The JARVIS computer control changed everything. It actually sees what I see and acts on it.",
      author: "Power User",
      handle: "@power_user",
    },
    {
      quote: "Tamper-evident audit log is the feature that sold me. I can verify every action XR took.",
      author: "Security Engineer",
      handle: "@sec_eng",
    },
  ];

  return (
    <section className="py-24 relative" ref={ref}>
      <div className="max-w-7xl mx-auto px-6">
        {/* Stats bar */}
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-20"
        >
          {stats.map((stat, i) => (
            <motion.div
              key={stat.label}
              variants={fadeUp}
              className="glass-card p-6 text-center"
            >
              <div className="flex items-center justify-center gap-2 mb-2">
                <stat.icon size={18} style={{ color: "#00D4FF" }} />
                <span className="font-syne font-bold text-2xl text-xr-cyan">
                  {stat.value}{stat.suffix}
                </span>
              </div>
              <span className="text-xs" style={{ color: "#64748B" }}>
                {stat.label}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* Quotes */}
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {quotes.map((q, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="glass-card p-7"
            >
              <div className="text-2xl mb-4" style={{ color: "#00D4FF" }}>
                &ldquo;
              </div>
              <p className="text-sm leading-relaxed mb-4" style={{ color: "#CBD5E1" }}>
                {q.quote}
              </p>
              <div>
                <span className="text-sm font-semibold" style={{ color: "#F1F5F9" }}>
                  {q.author}
                </span>
                <span className="text-xs ml-2" style={{ color: "#475569" }}>
                  {q.handle}
                </span>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── FAQ Section ──────────────────────────────────────────────────────────────

function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  const faqs = [
    {
      q: "What does BYOK mean?",
      a: "BYOK stands for 'Bring Your Own Key.' XR runs on your API key from any supported provider (Anthropic, OpenAI, Google, etc.) or your own local model via Ollama. We don't have access to your key or your data. It costs us $0 to maintain and you $0 to trust.",
    },
    {
      q: "How is the cost ceiling enforced?",
      a: "Every model call goes through checkBeforeStep() before it executes. If the estimated cost of the next step would exceed your configured budget, XR blocks the call and stops. It's not a warning — it's a hard stop enforced at the code level.",
    },
    {
      q: "Can I run XR completely offline?",
      a: "Yes. XR v0.5 supports Ollama for local inference. Onboarding can inspect your RAM/VRAM/CPU/disk, recommend a model, download it with your approval, and configure local-only or hybrid fallback routing.",
    },
    {
      q: "How does the audit log work?",
      a: "Every action XR takes is written to a local log file with a SHA-256 hash of the previous entry, creating an immutable chain (similar to how git works). You can run xr verify-log to check integrity. Any tampering — even a single character change — breaks the chain and is detected.",
    },
    {
      q: "What is JARVIS-level computer control?",
      a: "XR takes periodic screenshots of your screen, analyzes them using vision-capable models, and can take actions like clicking, typing, scrolling, and opening applications. This means you can describe what you want in natural language ('open Safari and search for X') and XR actually does it.",
    },
    {
      q: "Is XR safe to use?",
      a: "XR has multiple security layers: Docker sandbox for shell commands, egress allow-list to control data exfiltration, injection attack benchmarks, API key redaction before storage, and an allowlist for dangerous commands. The tamper-evident audit log means you can verify everything XR has done.",
    },
    {
      q: "What providers are supported?",
      a: "XR supports the providers implemented in the repo: Ollama, Groq, DeepSeek, Google Gemini, Together AI, OpenRouter, Cerebras, Mistral, OpenAI, Anthropic, Cohere, and AWS Bedrock.",
    },
    {
      q: "How do I update XR?",
      a: "Run xr update to pull the latest version. Skills are auto-managed — successful tasks create immutable baselines, and the system auto-rolls back if a skill regresses. You can also run xr doctor to check system health after updates.",
    },
  ];

  return (
    <section id="faq" className="py-24 relative" ref={ref}>
      <div className="max-w-3xl mx-auto px-6">
        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={fadeUp}
          className="text-center mb-16"
        >
          <span className="section-label">
            <MessageSquare size={14} />
            FAQ
          </span>
          <h2 className="section-heading text-4xl md:text-5xl font-syne">
            Frequently asked <span className="text-gradient-cyan">questions</span>
          </h2>
        </motion.div>

        <motion.div
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          variants={stagger}
          className="space-y-3"
        >
          {faqs.map((faq, i) => (
            <motion.div key={i} variants={fadeUp} className="faq-item">
              <button
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <span className="font-syne font-semibold text-sm" style={{ color: "#F1F5F9" }}>
                  {faq.q}
                </span>
                <motion.div
                  animate={{ rotate: openIndex === i ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown size={18} style={{ color: "#64748B" }} />
                </motion.div>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5">
                      <p className="text-sm leading-relaxed" style={{ color: "#94A3B8" }}>
                        {faq.a}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Final CTA ────────────────────────────────────────────────────────────────

function FinalCTA() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="py-24 relative" ref={ref}>
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse 60% 40% at 50% 50%, rgba(0, 212, 255, 0.08), transparent)",
        }}
      />
      <div className="max-w-3xl mx-auto px-6 text-center relative">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={inView ? { opacity: 1, scale: 1 } : {}}
          transition={{ duration: 0.6 }}
        >
          <img
            src="/avatar.png"
            alt="XR"
            className="w-24 h-24 object-contain mx-auto mb-8 rounded-full"
            style={{ filter: "drop-shadow(0 0 30px rgba(0, 212, 255, 0.5))" }}
          />
          <h2 className="font-syne font-bold text-4xl md:text-5xl mb-4">
            Ready to take <span className="text-gradient-cyan">control</span>?
          </h2>
          <p className="text-lg mb-10" style={{ color: "#94A3B8" }}>
            One command. Any OS. $0 to run. $0 to trust.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="#install" className="btn-primary font-syne">
              <Zap size={18} />
              Install Now — Free
            </a>
            <a
              href="https://github.com/ahmadrrrtx/xr"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary font-syne"
            >
              <Github size={18} />
              Star on GitHub
            </a>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer
      className="py-12 border-t"
      style={{ borderColor: "rgba(0, 212, 255, 0.06)" }}
    >
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo + tagline */}
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="XR"
              className="h-8 w-8 object-contain"
            />
            <div>
              <span className="font-syne font-bold text-base">XR</span>
              <span className="text-xs ml-2" style={{ color: "#475569" }}>
                by @ahmadrrrtx
              </span>
              <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                BYOK · Local-first · Tamper-evident
              </p>
            </div>
          </div>

          {/* Links */}
          <div className="flex flex-wrap items-center gap-6 text-sm" style={{ color: "#64748B" }}>
            <a href="https://github.com/ahmadrrrtx/xr" target="_blank" rel="noopener noreferrer" className="hover:text-xr-cyan transition-colors flex items-center gap-1">
              <Github size={14} /> GitHub
            </a>
            <a href="#features" className="hover:text-xr-cyan transition-colors">Features</a>
            <a href="#install" className="hover:text-xr-cyan transition-colors">Install</a>
            <a href="#security" className="hover:text-xr-cyan transition-colors">Security</a>
            <a href="#faq" className="hover:text-xr-cyan transition-colors">FAQ</a>
          </div>

          {/* MIT badge */}
          <div className="flex items-center gap-2 text-xs" style={{ color: "#475569" }}>
            <Shield size={12} />
            MIT Licensed · Open Source
          </div>
        </div>

        <div className="mt-8 pt-6 text-center text-xs" style={{ color: "#334155", borderTop: "1px solid rgba(0, 212, 255, 0.04)" }}>
          © 2026 XR Agent · Built by @ahmadrrrtx · MIT License
        </div>
      </div>
    </footer>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <main className="bg-xr-bg min-h-screen">
      <Navbar />
      <HeroSection />
      <ComparisonSection />
      <PillarsSection />
      <FeaturesSection />
      <ProvidersSection />
      <InstallSection />
      <SecuritySection />
      <SocialProofSection />
      <FAQSection />
      <FinalCTA />
      <Footer />
    </main>
  );
}
