/**
 * XR Phase 00 — shared helpers for baseline capture / validation.
 * Measurement-only. No production behavior changes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const ROOT = join(import.meta.dir, "..", "..");
export const BASELINE_DATE = "2026-08-15";
export const OUT_DIR = join(ROOT, "benchmarks", "baseline", BASELINE_DATE);

export const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g,
  /Bearer\s+[A-Za-z0-9._\-]{16,}/gi,
  /api[_-]?key["']?\s*[:=]\s*["'][^"']{8,}["']/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
];

export function ensureOutDir(): string {
  mkdirSync(OUT_DIR, { recursive: true });
  return OUT_DIR;
}

export function writeJson(name: string, value: unknown): string {
  ensureOutDir();
  const path = join(OUT_DIR, name);
  const text = JSON.stringify(value, null, 2) + "\n";
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`Refusing to write ${name}: possible secret matched ${re}`);
    }
  }
  writeFileSync(path, text);
  return path;
}

export function writeText(name: string, text: string): string {
  ensureOutDir();
  const path = join(OUT_DIR, name);
  for (const re of SECRET_PATTERNS) {
    if (re.test(text)) {
      throw new Error(`Refusing to write ${name}: possible secret matched ${re}`);
    }
  }
  writeFileSync(path, text.endsWith("\n") ? text : text + "\n");
  return path;
}

export function sha256File(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

export function stats(samplesMs: number[]): {
  sampleCount: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
  stdev: number;
} {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n ? sorted.reduce((a, b) => a + b, 0) / n : 0;
  const variance = n > 1 ? sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return {
    sampleCount: n,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    mean,
    stdev: Math.sqrt(variance),
  };
}

export async function runCapture(
  command: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    timeoutMs?: number;
  } = {},
): Promise<{ code: number; ms: number; stdout: string; stderr: string; timedOut: boolean }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...opts.env })) {
    if (v !== undefined) env[k] = v;
  }
  // Never leak host XR secrets into measurement children.
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.XR_TOKEN;
  delete env.OPENROUTER_API_KEY;
  delete env.GROQ_API_KEY;
  delete env.MISTRAL_API_KEY;
  delete env.TOGETHER_API_KEY;
  delete env.DEEPSEEK_API_KEY;
  delete env.FIREWORKS_API_KEY;
  delete env.COHERE_API_KEY;
  delete env.AZURE_OPENAI_API_KEY;
  delete env.HF_TOKEN;
  delete env.HUGGINGFACE_TOKEN;

  const start = performance.now();
  const proc = Bun.spawn(command, {
    cwd: opts.cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  if (opts.timeoutMs && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs);
  }

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return {
      code: code ?? (timedOut ? 124 : 1),
      ms: performance.now() - start,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function redactText(input: string): string {
  let out = input;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  // Long hex tokens (daemon tokens are 48 hex chars)
  out = out.replace(/\b[a-f0-9]{32,}\b/gi, "[REDACTED_HEX]");
  return out;
}

export function freshXrHome(label: string): string {
  const dir = join(tmpdir(), `xr-p00-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function summarizeCommandResult(r: {
  code: number;
  ms: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): {
  code: number;
  ms: number;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
} {
  return {
    code: r.code,
    ms: r.ms,
    timedOut: r.timedOut,
    stdoutTail: redactText(r.stdout).slice(-2000),
    stderrTail: redactText(r.stderr).slice(-2000),
  };
}

export type GateStatus = "PASS" | "FAIL" | "SKIP" | "BLOCKED" | "UNAVAILABLE" | "PRE_EXISTING_GAP";

export function targetCompare(
  p95: number | null | undefined,
  targetMs: number | null | undefined,
): "MEETS_TARGET" | "PRE_EXISTING_GAP" | "NOT_MEASURED" {
  if (p95 == null || targetMs == null) return "NOT_MEASURED";
  return p95 <= targetMs ? "MEETS_TARGET" : "PRE_EXISTING_GAP";
}
