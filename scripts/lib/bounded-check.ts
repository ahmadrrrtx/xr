/** Async process-group watchdog. Bun's Node spawnSync timeout cannot safely
 * bound a wedged child; keep the event loop alive and stream diagnostics. */
import { spawn } from "node:child_process";
export interface CheckResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
  error?: string;
  wallMs: number;
}
export async function boundedCheck(
  argv: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxOutputBytes?: number;
    onOutput?: (text: string) => void;
  },
): Promise<CheckResult> {
  const started = performance.now(),
    max = options.maxOutputBytes ?? 24 * 1024 * 1024;
  if (
    !argv.length ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    !Number.isSafeInteger(max) ||
    max < 1
  )
    throw new Error("Invalid bounded check");
  return new Promise((resolve) => {
    let timedOut = false,
      outputTruncated = false,
      bytes = 0,
      error: string | undefined,
      done = false;
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let force: ReturnType<typeof setTimeout> | undefined,
      drain: ReturnType<typeof setTimeout> | undefined;
    const finish = (exitCode: number | null, signal: string | null) => {
      if (done) return;
      done = true;
      if (timedOut || outputTruncated) kill("SIGKILL");
      process.off("SIGTERM", parentTerm);
      process.off("SIGINT", parentInt);
      clearTimeout(timer);
      if (force) clearTimeout(force);
      if (drain) clearTimeout(drain);
      resolve({
        exitCode,
        signal,
        timedOut,
        outputTruncated,
        ...(error ? { error } : {}),
        wallMs: performance.now() - started,
      });
    };
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        /* already exited */
      }
    };
    const stop = () => {
      kill("SIGTERM");
      force = setTimeout(() => {
        kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        drain = setTimeout(() => finish(null, "SIGKILL"), 500);
      }, 500);
    };
    const parentTerm = () => {
        kill("SIGKILL");
        process.exit(143);
      },
      parentInt = () => {
        kill("SIGKILL");
        process.exit(130);
      };
    process.once("SIGTERM", parentTerm);
    process.once("SIGINT", parentInt);
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    const output = (data: Buffer) => {
      const allowed = Math.max(0, max - bytes);
      bytes += data.byteLength;
      if (allowed)
        options.onOutput?.(data.subarray(0, allowed).toString("utf8"));
      if (bytes > max && !outputTruncated) {
        outputTruncated = true;
        stop();
      }
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.on("error", (e) => {
      error = (e as NodeJS.ErrnoException).code ?? "spawn failure";
      finish(127, null);
    });
    child.on("close", (code, signal) => finish(code, signal));
  });
}
