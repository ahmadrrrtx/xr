/**
 * XR Stage 9 — Computer Control: action schema and shared types.
 */
import { z } from "zod";

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("app"), name: z.string().min(1).max(200) }),
  z.object({ type: z.literal("close"), name: z.string().min(1).max(200) }),
  z.object({ type: z.literal("focus"), name: z.string().min(1).max(200) }),
  z.object({ type: z.literal("open"), target: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("type"), text: z.string().min(1).max(8000), sensitive: z.boolean().optional() }),
  z.object({
    type: z.literal("click"),
    x: z.number().int().min(0).max(20000).optional(),
    y: z.number().int().min(0).max(20000).optional(),
    target: z.string().min(1).max(200).optional(),
    button: z.enum(["left","right","double"]).default("left"),
  }),
  z.object({
    type: z.literal("drag_drop"),
    x1: z.number().int().min(0).max(20000),
    y1: z.number().int().min(0).max(20000),
    x2: z.number().int().min(0).max(20000),
    y2: z.number().int().min(0).max(20000),
    holdMs: z.number().int().min(0).max(5000).optional(),
  }),
  z.object({ type: z.literal("move"), x: z.number().int().min(0).max(20000), y: z.number().int().min(0).max(20000) }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up","down","left","right"]), amount: z.number().int().min(1).max(50).default(3) }),
  z.object({ type: z.literal("key"), keys: z.array(z.string().min(1).max(30)).min(1).max(6) }),
  z.object({ type: z.literal("wait_ms"), ms: z.number().int().min(50).max(15000) }),
  // Browser
  z.object({
    type: z.literal("browser"),
    op: z.enum(["goto","click","fill","type","press","wait","submit","screenshot","extract","close","new_tab","close_tab","switch_tab","upload","drag"]),
    selector: z.string().min(1).max(500).optional(),
    value: z.string().max(8000).optional(),
    sensitive: z.boolean().optional(),
    timeoutMs: z.number().int().min(100).max(60000).optional(),
    tabIndex: z.number().int().min(0).max(50).optional(),
  }),
  // Files
  z.object({
    type: z.literal("file"),
    op: z.enum(["read","write","list","mkdir","move","delete"]),
    path: z.string().min(1).max(2000),
    content: z.string().max(500_000).optional(),
    targetPath: z.string().max(2000).optional(),
  }),
  // Editor
  z.object({
    type: z.literal("editor"),
    op: z.enum(["open"]),
    editor: z.enum(["code","cursor","vim","auto"]).default("auto"),
    file: z.string().max(2000).optional(),
    line: z.number().int().min(1).max(1_000_000).optional(),
  }),
  // Screenshot
  z.object({
    type: z.literal("screenshot"),
    target: z.enum(["screen","window","browser"]).default("screen"),
    savePath: z.string().max(2000).optional(),
  }),
  // System
  z.object({
    type: z.literal("system"),
    op: z.enum(["clipboard_read","clipboard_write","notify","volume_get","volume_set"]),
    value: z.string().max(4000).optional(),
    level: z.number().int().min(0).max(100).optional(),
    title: z.string().max(200).optional(),
  }),
  // Computer-use
  z.object({
    type: z.literal("computer_use"),
    task: z.string().min(3).max(500),
    maxSteps: z.number().int().min(1).max(30).optional(),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type RiskLevel = "safe" | "sensitive" | "destructive";
export interface RiskAssessment { level: RiskLevel; reason: string; reversible: boolean; }

export type ExecutionMode = "auto" | "step" | "dry-run";
export interface ControlOptions {
  mode: ExecutionMode;
  autoApproveSensitive?: boolean;
  delayMs?: number;
}
export interface ActionResult { ok: boolean; message: string; skipped?: boolean; data?: unknown }

export interface Plan {
  task: string;
  actions: Action[];
  rationale?: string;
}

export type PermissionScope =
  | "desktop"
  | "browser"
  | "files_read"
  | "files_write"
  | "system"
  | "clipboard"
  | "vision_cloud";

export interface ControlSession {
  id: string;
  task: string;
  mode: ExecutionMode;
  status: "planned"|"running"|"awaiting_approval"|"paused"|"done"|"error"|"cancelled";
  steps: Action[];
  currentStep: number;
  auditTrail: { ts: number; action: string; ok: boolean }[];
  startedAt: number;
  updatedAt: number;
}

export interface ControlCapabilities {
  os: "linux"|"macos"|"windows";
  tools: { keyboard: boolean; mouse: boolean; launcher: boolean; windows: boolean };
  missing: string[];
}
