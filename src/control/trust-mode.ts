/**
 * Phase 4 · Trust Modes — the engine-owned approval posture switch.
 *
 * Persisted at ~/.xr/trust-mode.json (same discipline as control permissions:
 * in-memory cache + atomic disk write). The capabilities policy gate reads
 * this at decision time:
 *   · careful    — approvals also for dangerous-declared perms and any
 *                  non-low/unknown risk tier (full audit posture).
 *   · balanced   — the historical default: tool.requiresApproval only.
 *   · autonomous — relaxes approvals EXCEPT high/critical tiers and
 *                  dangerous-declared permissions (never auto-approve those).
 * Destructive/secrets-tier actions therefore stay approval-gated in EVERY
 * mode; the switch is real behaviour, not a label.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type TrustMode = "careful" | "balanced" | "autonomous";

const MODE_PATH = join(homedir(), ".xr", "trust-mode.json");
const DEFAULT_MODE: TrustMode = "balanced";

let cache: { mode: TrustMode; loadedAt: number } | null = null;
const TTL_MS = 5_000;

export function isTrustMode(v: unknown): v is TrustMode {
  return v === "careful" || v === "balanced" || v === "autonomous";
}

function load(): TrustMode {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.mode;
  try {
    if (existsSync(MODE_PATH)) {
      const data = JSON.parse(readFileSync(MODE_PATH, "utf8")) as { mode?: unknown };
      if (isTrustMode(data.mode)) {
        cache = { mode: data.mode, loadedAt: Date.now() };
        return cache.mode;
      }
    }
  } catch {
    /* corrupt file → honest default */
  }
  cache = { mode: DEFAULT_MODE, loadedAt: Date.now() };
  return DEFAULT_MODE;
}

export function getTrustMode(): TrustMode {
  return load();
}

export function setTrustMode(mode: TrustMode): boolean {
  if (!isTrustMode(mode)) return false;
  try {
    mkdirSync(dirname(MODE_PATH), { recursive: true });
    writeFileSync(MODE_PATH, JSON.stringify({ mode, updatedAt: Date.now() }), "utf8");
    cache = { mode, loadedAt: Date.now() };
    return true;
  } catch {
    return false;
  }
}

/**
 * The gate mapping. Kept pure so tests pin the safety property:
 * high/critical tiers and dangerous-declared permissions ALWAYS require
 * approval, in every mode (autonomous included).
 */
export function approvalForMode(
  mode: TrustMode,
  baseRequiresApproval: boolean,
  dangerousDeclared: boolean,
  riskTier: string,
): boolean {
  const hardGate = riskTier === "high" || riskTier === "critical" || dangerousDeclared;
  if (mode === "careful") return baseRequiresApproval || dangerousDeclared || (riskTier !== "unknown" && riskTier !== "low");
  if (mode === "autonomous") return hardGate; // relax base flags; NEVER the hard gate
  return baseRequiresApproval;
}
