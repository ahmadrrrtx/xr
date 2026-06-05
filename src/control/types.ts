/**
 * XR v0.8 — Computer Control: action schema and shared types.
 *
 * Every action XR can take on the user's machine is one of the variants below.
 * The schema is intentionally small, explicit, and validated at the edge so
 * higher-level planners can produce these actions without bypassing safety.
 */

import { z } from "zod";

// ── Action schema ────────────────────────────────────────────────────────────

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("app"),
    /** Application name as the OS knows it (e.g. "Safari", "code", "Notepad"). */
    name: z.string().min(1).max(200),
  }),
  z.object({
    type: z.literal("open"),
    /** A URL (http/https/file) or a local path. Nothing else is allowed. */
    target: z.string().min(1).max(2000),
  }),
  z.object({
    type: z.literal("type"),
    /** Text to type into the currently focused window. */
    text: z.string().min(1).max(4000),
    /** If true, the text is treated as a literal password/sensitive value
     * and is never written to the audit log in plaintext. */
    sensitive: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("click"),
    /** Either explicit coordinates… */
    x: z.number().int().min(0).max(20000).optional(),
    y: z.number().int().min(0).max(20000).optional(),
    /** …or a human description ("Login button"). When provided without
     * coordinates the executor will refuse unless a vision backend is wired,
     * which v0.8 deliberately does not ship. This keeps clicks deterministic. */
    target: z.string().min(1).max(200).optional(),
    button: z.enum(["left", "right", "double"]).default("left"),
  }),
  z.object({
    type: z.literal("move"),
    x: z.number().int().min(0).max(20000).optional(),
    y: z.number().int().min(0).max(20000).optional(),
    target: z.string().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(50).default(3),
  }),
  z.object({
    type: z.literal("key"),
    /** Key combo as an array: ["ctrl","c"], ["cmd","tab"], ["enter"]. */
    keys: z.array(z.string().min(1).max(20)).min(1).max(6),
  }),
  z.object({
    type: z.literal("focus"),
    /** Bring an existing window/app to the front. */
    name: z.string().min(1).max(200),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

// ── Risk model ───────────────────────────────────────────────────────────────

/**
 * `safe`        — informational or low-impact: focus, move mouse, scroll.
 * `sensitive`   — does something the user will perceive: open app/URL,
 *                 type text, click coordinates.  Confirmed unless --yes.
 * `destructive` — could submit a form, send a message, run code, delete
 *                 something.  Confirmed *every time*, ignoring --yes.
 */
export type RiskLevel = "safe" | "sensitive" | "destructive";

export interface RiskAssessment {
  level: RiskLevel;
  reason: string;
  /** Best-effort hint to the user: can this likely be undone? */
  reversible: boolean;
}

// ── Execution context ────────────────────────────────────────────────────────

export type ExecutionMode = "auto" | "step" | "dry-run";

export interface ControlOptions {
  /** "dry-run" never touches the OS. "step" confirms every single action.
   *  "auto" runs safe actions immediately and prompts on sensitive/destructive. */
  mode: ExecutionMode;
  /** Skip the prompt for `sensitive` actions only.  Destructive still prompts. */
  autoApproveSensitive?: boolean;
  /** Pause between actions (ms). Useful when scripting flows. */
  delayMs?: number;
}

export interface ActionResult {
  ok: boolean;
  /** Free-form, human-readable. Never contains raw secrets. */
  message: string;
  /** True if the executor skipped the action because of dry-run / denial. */
  skipped?: boolean;
}

export interface ControlCapabilities {
  os: "linux" | "macos" | "windows";
  /** Which low-level tools are present.  Missing tools degrade capability,
   *  they don't crash XR. */
  tools: {
    /** macOS: always true. Linux: xdotool. Windows: PowerShell SendKeys. */
    keyboard: boolean;
    mouse: boolean;
    /** Can launch apps / open URLs. Always true on supported platforms. */
    launcher: boolean;
    /** Can enumerate windows. */
    windows: boolean;
  };
  /** Names of missing tools, with install hints. */
  missing: string[];
}
