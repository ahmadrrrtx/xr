/**
 * XR — Docker Sandbox for Shell Execution
 * 
 * When XR executes shell commands, they run in an isolated Docker container
 * with no network, no filesystem access outside the project, and dropped
 * capabilities. This is what OpenClaw should have done by default.
 * 
 * This prevents:
 * - `curl ... | bash` attacks
 * - File exfiltration via network
 * - Privilege escalation
 * - Access to ~/.ssh, ~/.aws, etc.
 * 
 * The container is created per-task and destroyed after.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DOCKER_IMAGE = "bun:1-alpine";
const CONTAINER_PREFIX = "xr-sandbox-";

export interface SandboxOptions {
  // Working directory to mount (read-only preferred)
  workingDir: string;
  // Extra volumes to mount
  volumes?: Array<{ host: string; container: string; readonly?: boolean }>;
  // Environment variables to pass
  env?: Record<string, string>;
  // Timeout in seconds
  timeout?: number;
  // Allow network access (default: false)
  allowNetwork?: boolean;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  containerId: string;
}

/**
 * Check if Docker is available and running
 */
export function dockerAvailable(): { available: boolean; version?: string; error?: string } {
  try {
    const out = execSync("docker --version 2>/dev/null", { timeout: 5000 }).toString().trim();
    const v = out.match(/Docker version ([\d.]+)/)?.[1];
    return { available: true, version: v };
  } catch (e) {
    return { available: false, error: (e as Error).message };
  }
}

/**
 * Run a command in an isolated Docker sandbox
 */
export async function runInSandbox(
  command: string,
  opts: SandboxOptions
): Promise<SandboxResult> {
  const start = Date.now();
  const containerId = CONTAINER_PREFIX + randomUUID().slice(0, 8);
  const timeout = opts.timeout ?? 60;
  const workingDir = opts.workingDir;
  
  // Build docker run arguments
  const args: string[] = [
    "docker", "run", "--rm",
    "--name", containerId,
    "--network", opts.allowNetwork ? "bridge" : "none",
    // Drop ALL capabilities
    "--cap-drop=ALL",
    // No new privileges
    "--security-opt=no-new-privileges",
    // Read-only root filesystem (except our volumes)
    "--read-only",
    // Prevent fork bombs
    "--pids-limit", "64",
    // Memory limit
    "--memory", "512m",
    "--memory-swap", "512m",
    // CPU limit
    "--cpus", "1",
    // Timeout
    "--stop-timeout", String(Math.ceil(timeout / 2)),
    // Mount working directory as read-only
    "-v", `${workingDir}:/workspace:ro`,
    // Workdir
    "-w", "/workspace",
  ];
  
  // Add extra volumes
  if (opts.volumes) {
    for (const vol of opts.volumes) {
      const ro = vol.readonly ? ":ro" : "";
      args.push("-v", `${vol.host}:${vol.container}${ro}`);
    }
  }
  
  // Add env vars (only safe ones, no secrets)
  const safeEnv = {
    ...opts.env,
    // Always add these for reproducibility
    HOME: "/root",
    PATH: "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  
  // DO NOT pass API keys, credentials, etc.
  // Filter out any env var that might be a secret
  for (const [key, value] of Object.entries(safeEnv)) {
    if (!key.startsWith("XR_") && !["HOME", "PATH", "LANG", "LC_ALL", "SHELL", "USER", "TERM"].includes(key)) {
      continue; // skip — don't expose
    }
    args.push("-e", `${key}=${value}`);
  }
  
  // The image
  args.push(DOCKER_IMAGE, "sh", "-c", command);
  
  try {
    const stdout = execSync(args.join(" "), {
      timeout: timeout * 1000,
      maxBuffer: 1024 * 1024 * 2, // 2MB output limit
    }).toString();
    
    return {
      stdout,
      stderr: "",
      exitCode: 0,
      durationMs: Date.now() - start,
      containerId,
    };
  } catch (e) {
    const err = e as any;
    const stdout = err.stdout?.toString() ?? "";
    const stderr = err.stderr?.toString() ?? "";
    const exitCode = err.status ?? 1;
    
    return {
      stdout,
      stderr,
      exitCode,
      durationMs: Date.now() - start,
      containerId,
    };
  }
}

/**
 * Run in sandbox with automatic Docker detection.
 * Falls back to local execution if Docker isn't available.
 */
export async function runCommand(
  command: string,
  cwd: string,
  allowNetwork = false
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  sandboxed: boolean;
  durationMs: number;
}> {
  const start = Date.now();
  const check = dockerAvailable();
  
  if (!check.available) {
    // Docker not available — run locally with dangerous-command filter
    // The dangerous command patterns are already blocked in system.ts
    return runLocalCommand(command, cwd);
  }
  
  try {
    const result = await runInSandbox(command, {
      workingDir: cwd,
      allowNetwork,
      timeout: 120,
    });
    
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      sandboxed: true,
      durationMs: result.durationMs,
    };
  } catch (e) {
    // Sandbox failed — fallback to local
    return runLocalCommand(command, cwd);
  }
}

/**
 * Local command execution (when Docker unavailable)
 */
function runLocalCommand(command: string, cwd: string): {
  stdout: string; stderr: string; exitCode: number; sandboxed: boolean; durationMs: number;
} {
  const start = Date.now();
  
  // Additional dangerous command filtering before execution
  const dangerous = [
    /rm\s+-rf\s+\/(?:\s|$)/, // rm -rf /
    /mkfs/, // format disk
    /dd\s+if=/, // direct disk write
    /curl\s+[^\s]+\s*\|\s*(bash|sh|sh\s+-c)/i, // pipe to shell
    /wget\s+[^\s]+\s*\|\s*(bash|sh|sh\s+-c)/i, // wget pipe to shell
  ];
  
  for (const pattern of dangerous) {
    if (pattern.test(command)) {
      return {
        stdout: "",
        stderr: `Blocked dangerous command: ${command.match(pattern)?.[0] ?? command.slice(0, 50)}`,
        exitCode: 126,
        sandboxed: false,
        durationMs: Date.now() - start,
      };
    }
  }
  
  try {
    const stdout = execSync(command, {
      cwd,
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 2,
    }).toString();
    
    return {
      stdout,
      stderr: "",
      exitCode: 0,
      sandboxed: false,
      durationMs: Date.now() - start,
    };
  } catch (e) {
    const err = e as any;
    return {
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
      exitCode: err.status ?? 1,
      sandboxed: false,
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Pull the sandbox image (call during setup)
 */
export function ensureSandboxImage(): boolean {
  try {
    console.log("Pulling XR sandbox image (bun:1-alpine)…");
    execSync("docker pull bun:1-alpine", { stdio: "inherit", timeout: 180000 });
    return true;
  } catch (e) {
    console.log(`Sandbox image pull failed: ${(e as Error).message}`);
    console.log("Shell commands will run locally (without container isolation).");
    console.log("To enable sandboxing: docker pull bun:1-alpine");
    return false;
  }
}

/**
 * Check sandbox status
 */
export function sandboxStatus(): {
  available: boolean;
  imagePulled: boolean;
  version?: string;
  error?: string;
} {
  const check = dockerAvailable();
  if (!check.available) {
    return { available: false, imagePulled: false, error: check.error };
  }
  
  try {
    execSync("docker image inspect bun:1-alpine --format '{{.Id}}' 2>/dev/null", { timeout: 5000 });
    return { available: true, imagePulled: true, version: check.version };
  } catch {
    return { available: true, imagePulled: false, version: check.version };
  }
}
