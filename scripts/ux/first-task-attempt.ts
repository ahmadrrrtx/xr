#!/usr/bin/env bun
/**
 * XR Phase 8 · T4 — one first-task attempt (worker).
 *
 * Spawned by scripts/first-task-survey.ts with a FRESH, empty XR_HOME+HOME.
 * Performs the canonical first task — "install XR and get your first answer" —
 * and prints exactly ONE JSON line describing every step outcome, so the
 * survey driver can aggregate a success rate with named failure steps.
 *
 * XR_HOME is a module-load-time constant, which is why each attempt MUST be a
 * fresh process: the parent sets it in the child env before anything loads.
 *
 * The "answer" uses the deterministic in-process execution stub (same harness
 * style as scripts/golden-path.ts): no network, no model download, full
 * persistence — the survey measures the UX JOURNEY (install → boot → answer),
 * not model availability.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type StepResult = { step: string; ok: boolean; detail?: string; ms: number };

const steps: StepResult[] = [];
function record(step: string, ok: boolean, ms: number, detail?: string): boolean {
  steps.push({ step, ok, ms, ...(detail ? { detail: detail.slice(0, 300) } : {}) });
  return ok;
}

async function attempt(): Promise<void> {
  const XR_HOME = process.env.XR_HOME;
  const HOME = process.env.HOME;
  if (!XR_HOME || !HOME) {
    console.log(JSON.stringify({ ok: false, step: "env", error: "XR_HOME and HOME must be pinned" }));
    process.exit(1);
  }
  const packageRoot = join(import.meta.dir, "../..");
  const t0 = Date.now();

  // 1. Install (the first thing a real new user runs).
  let t = Date.now();
  const install = spawnSync(
    process.execPath,
    ["run", "src/index.ts", "install", "--mode", "minimal", "--yes", "--from-bootstrap"],
    { cwd: packageRoot, env: process.env, encoding: "utf8", timeout: 240_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (!record("install-exit-0", install.status === 0 && !install.error, Date.now() - t, (install.stderr ?? "").slice(-300))) {
    finish(t0);
    return;
  }

  t = Date.now();
  const configOk = existsSync(join(XR_HOME, "config.json")) && existsSync(join(XR_HOME, "xr.db"));
  record("install-materializes-home", configOk, Date.now() - t);
  // Even if files are missing, keep going so later step outcomes are observable.

  // 2. Boot the runtime exactly as the shell would.
  t = Date.now();
  let kernelBooted = false;
  let kernel: { shutdown: () => Promise<void> } | null = null;
  try {
    const { XRKernel } = await import("../../src/core/kernel.ts");
    const k = new XRKernel();
    await k.bootstrap();
    kernel = k;
    kernelBooted = true;
  } catch (err) {
    record("runtime-boots", false, Date.now() - t, err instanceof Error ? err.message : String(err));
  }
  if (kernelBooted) record("runtime-boots", true, Date.now() - t);

  // 3. First answer through the real execution spine.
  t = Date.now();
  let answered = false;
  if (kernelBooted) {
    try {
      const { XRKernel } = await import("../../src/core/kernel.ts");
      const { Tokens } = await import("../../src/core/tokens.ts");
      const k = kernel as unknown as InstanceType<typeof XRKernel>;
      const exec = k.registry.resolve(Tokens.Execution);
      const res = await exec.execute({
        workspaceId: "default",
        capability: { kind: "model_call", name: "first_task_model" },
        actor: { kind: "user", source: "cli" },
        intent: { summary: "first task answer", origin: { kind: "user", source: "cli" } },
        idempotency: "naturally_idempotent",
        inputSummary: "what is XR?",
        run: async () => ({ summary: "XR is a local-first AI agent runtime.", transportOk: true }),
      });
      answered = res.outcome?.kind === "succeeded";
      record("first-answer-succeeds", answered, Date.now() - t, answered ? undefined : JSON.stringify(res.outcome));

      // 4. The answer leaves evidence (a user can ask "what just happened?").
      t = Date.now();
      const store = k.registry.resolve(Tokens.Store);
      record("answer-is-audited", store.auditCount() > 0 && store.verifyChain().valid === true, Date.now() - t);
    } catch (err) {
      record("first-answer-succeeds", false, Date.now() - t, err instanceof Error ? err.message : String(err));
    }
  }

  if (kernel) await kernel.shutdown();
  finish(t0);
}

function finish(t0: number): void {
  const success = steps.length > 0 && steps.every((s) => s.ok);
  const firstFail = steps.find((s) => !s.ok);
  console.log(
    JSON.stringify({
      ok: success,
      totalMs: Date.now() - t0,
      failedStep: firstFail?.step ?? null,
      detail: firstFail?.detail ?? null,
      steps,
    }),
  );
}

attempt().catch((err: unknown) => {
  console.log(JSON.stringify({ ok: false, failedStep: "uncaught", detail: String(err instanceof Error ? err.message : err).slice(0, 300), steps }));
});
