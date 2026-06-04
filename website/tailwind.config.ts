import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        xr: {
          bg: "#020817",
          "bg-secondary": "#0A0F1E",
          card: "#0F172A",
          border: "rgba(0, 212, 255, 0.15)",
          "border-hover": "rgba(0, 212, 255, 0.4)",
          cyan: "#00D4FF",
          "cyan-muted": "#0EA5E9",
          green: "#00FF88",
          "green-muted": "#10B981",
          amber: "#F59E0B",
          text: "#F8FAFC",
          "text-secondary": "#94A3B8",
          "text-muted": "#475569",
        },
      },
      fontFamily: {
        syne: ["Syne", "system-ui", "sans-serif"],
        jakarta: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      backgroundImage: {
        "grid-pattern": "linear-gradient(rgba(0, 212, 255, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 212, 255, 0.03) 1px, transparent 1px)",
        "hero-glow": "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(0, 212, 255, 0.15), transparent)",
        "card-glow": "radial-gradient(ellipse at center, rgba(0, 212, 255, 0.05), transparent 70%)",
      },
      backgroundSize: {
        "grid": "40px 40px",
      },
      animation: {
        "spin-slow": "spin 20s linear infinite",
        "spin-slower": "spin 30s linear infinite reverse",
        "pulse-glow": "pulseGlow 3s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "bounce-slow": "bounceSlow 2s ease-in-out infinite",
        "fade-in-up": "fadeInUp 0.6s ease-out forwards",
        "counter": "counter 2s ease-out forwards",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        bounceSlow: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(8px)" },
        },
        fadeInUp: {
          "0%": { opacity: "0", transform: "translateY(40px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        counter: {
          "0%": { "--num": "0" },
          "100%": { "--num": "var(--target)" },
        },
      },
      boxShadow: {
        "cyan-glow": "0 0 30px rgba(0, 212, 255, 0.3)",
        "green-glow": "0 0 30px rgba(0, 255, 136, 0.3)",
        "card-glow": "0 0 60px rgba(0, 212, 255, 0.1)",
        "inner-cyan": "inset 0 0 30px rgba(0, 212, 255, 0.05)",
      },
    },
  },
  plugins: [],
};

export default config;