/**
 * XR Phase 3 · T1 — CLI router (lazy)
 *
 * Resolves argv → fast path | registered command | default `run` task.
 * Preserves full backwards compatibility with legacy command names.
 * Version is derived from src/core/version.ts single source of truth.
 *
 * Phase 3 changes (Commandment 11 / Article VI · Rule 4):
 *   - NO static imports of command modules, the daemon, or the kernel.
 *     The router's own import graph is ~10 lightweight modules; fast paths
 *     (`--version`, `--help`, `xr <cmd> --help`, `shell`, `serve`) never
 *     load the kernel.
 *   - Command dispatch goes through `bootKernelForCommand` (dynamic import
 *     of the kernel with a static literal path — compile-safe for
 *     `bun --compile`) and command-scoped boot profiles.
 *   - Commands themselves are lazy-loaded on first execution via
 *     src/cli/command-loaders.ts (literal-path dynamic imports only).
 */

import { parseGlobalFlags, EXIT, type GlobalFlags } from "./flags.ts";
import { setOutputFlags, emitJson, isJsonMode, printDidYouMean, printError, tip } from "./output.ts";
import { handleFatal, usageError, CliError } from "./errors.ts";
import { CORE_VERSION, CODENAME, PKG, DISPLAY_VERSION, versionInfo } from "../core/version.ts";
import { resolveCommandName, getCatalogEntry, allAliasesAndNames } from "./catalog.ts";
import { decideRoute } from "./route-decision.ts";
import { showHelp, showCommandHelp } from "./help.ts";
import { bootTrace } from "../core/boot-trace.ts";
import { installCommandLoaders } from "./command-loaders.ts";
// Type-only: erased at compile time — must never load the kernel at runtime.
import type { XRKernel } from "../core/kernel.ts";

// ── Serve ─────────────────────────────────────────────────────────────────────

function parseServePort(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--port" && args[i + 1]) return Number.parseInt(args[i + 1]!, 10);
    if (arg?.startsWith("--port=")) return Number.parseInt(arg.slice("--port=".length), 10);
  }
  return undefined;
}

async function runServeCommand(args: string[]): Promise<void> {
  const { serve } = await import("../daemon/server.ts"); // static literal — compile-safe
  const port = parseServePort(args);
  const handle = await serve({ port: Number.isFinite(port) ? port : undefined });
  await new Promise<void>((resolve) => {
    const stop = () => {
      try {
        handle.stop();
      } catch {
        /* ignore */
      }
      resolve();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
}

// ── Kernel helpers ────────────────────────────────────────────────────────────

async function withKernel(command: string, flags: GlobalFlags, fn: (kernel: XRKernel) => Promise<void>): Promise<void> {
  const { bootKernelForCommand } = await import("./kernel-boot.ts"); // static literal — compile-safe
  const { kernel, profile } = await bootKernelForCommand(command);
  void profile;

  // Workspace override before start (if requested)
  if (flags.workspace) {
    try {
      const list = kernel.workspaces.listWorkspaces();
      if (list.some((w) => w.id === flags.workspace)) {
        await kernel.switchWorkspace(flags.workspace);
      }
    } catch {
      // switchWorkspace needs bootstrap complete; ignore soft failures
    }
  }

  try {
    await fn(kernel);
  } finally {
    await kernel.shutdown();
    bootTrace.emit();
  }
}

function injectRunOverrides(args: string[], flags: GlobalFlags): string[] {
  const out = [...args];
  // Prefer explicit flags already in args; only inject missing globals
  const has = (flag: string) => out.includes(flag);
  if (flags.mode && !has("--mode")) out.push("--mode", flags.mode);
  if (flags.model && !has("--model")) out.push("--model", flags.model);
  if (flags.provider && !has("--provider")) out.push("--provider", flags.provider);
  if (flags.budget != null && !has("--budget")) out.push("--budget", String(flags.budget));
  if (flags.maxTokens != null && !has("--max-tokens")) out.push("--max-tokens", String(flags.maxTokens));
  if (flags.dryRun && !has("--dry-run")) out.push("--dry-run");
  if (flags.resume && !has("--resume")) out.push("--resume", flags.resume);
  return out;
}

/**
 * Re-attach global flags that the shared parser consumed so legacy command
 * handlers still see `--json`, `--quiet`, etc. on `ctx.args`.
 */
function reinjectGlobalFlags(args: string[], flags: GlobalFlags): string[] {
  const out = [...args];
  const has = (flag: string) => out.includes(flag);
  if (flags.json && !has("--json")) out.push("--json");
  if (flags.yaml && !has("--yaml")) out.push("--yaml");
  if (flags.quiet && !has("--quiet") && !has("-q")) out.push("--quiet");
  if (flags.verbose && !has("--verbose")) out.push("--verbose");
  if (flags.debug && !has("--debug")) out.push("--debug");
  if (flags.yes && !has("--yes") && !has("-y")) out.push("--yes");
  if (flags.noColor && !has("--no-color")) out.push("--no-color");
  if (flags.workspace && !has("--workspace") && !has("-w")) {
    out.push("--workspace", flags.workspace);
  }
  // Provider/model globals are ALSO command-local flags for subcommands like
  // `xr providers route --provider ollama` / `xr providers measure --model X`
  // — re-attach them so the shared parser doesn't silently swallow the
  // operator's explicit selection (Phase 5: honest CLI, no dropped flags).
  if (flags.provider && !has("--provider") && !has("-p")) {
    out.push("--provider", flags.provider);
  }
  if (flags.model && !has("--model") && !has("-m")) {
    out.push("--model", flags.model);
  }
  if (flags.format && flags.format !== "text" && !has("--format") && !has("--output") && !has("-o")) {
    out.push("--format", flags.format);
  }
  return out;
}

/**
 * Read the exit code a command signalled through `process.exitCode`.
 *
 * Commands report failure by assigning `process.exitCode`; the router must
 * surface that rather than overwrite it with success (Phase 0 · T11).
 */
function currentExitCode(): number {
  const code = process.exitCode;
  if (typeof code === "number" && code !== 0) return code;
  return EXIT.OK;
}

// ── Unknown command UX ────────────────────────────────────────────────────────

function unknownCommand(name: string): never {
  const candidates = allAliasesAndNames().filter((n) => !n.startsWith("-"));
  printError({
    id: "unknown_command",
    what: `Unknown command: ${name}`,
    why: "That name is not a registered XR command or legacy alias.",
    fix: ["Run xr help to browse commands.", 'Free-form tasks go through: xr "your task"'],
    related: ["xr help", "xr doctor"],
    code: EXIT.USAGE,
  });
  printDidYouMean(name, candidates);
  throw new CliError({
    id: "unknown_command",
    what: `Unknown command: ${name}`,
    code: EXIT.USAGE,
  });
}

/**
 * Register all CLI commands on a kernel. Phase 3 · T1: registration is
 * LAZY — no command module is imported until first execution. Kept as a
 * named export for API compatibility (src/cli/index.ts re-exports it).
 */
export function registerCommands(kernel: XRKernel): void {
  installCommandLoaders(kernel.commands);
}

// ── Public entry ──────────────────────────────────────────────────────────────

export async function runCli(argv: string[]): Promise<number> {
  const cleaned = argv.filter((a) => a !== "--from-bootstrap");
  const flags = parseGlobalFlags(cleaned);
  setOutputFlags(flags);

  const head = flags.args[0];
  const rest = flags.args.slice(1);

  try {
    // ── Route decision (pure, no kernel, no command modules) ─────────────
    const route = decideRoute({
      head,
      flagsVersion: flags.version,
      flagsHelp: flags.help,
      wantsCommandHelp: !!head && (rest.includes("--help") || rest.includes("-h")),
    });

    // ── Version (fast) ────────────────────────────────────────────────────
    if (route.kind === "version") {
      if (isJsonMode()) {
        emitJson({
          name: PKG.name,
          version: CORE_VERSION,
          codename: CODENAME,
          display: DISPLAY_VERSION,
          cli: CODENAME,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          repo: PKG.repo,
          homepage: PKG.homepage,
          npm: PKG.npm,
          pluginApi: versionInfo().pluginApi,
        });
      } else {
        console.log(`v${CORE_VERSION} (${CODENAME})`);
      }
      return EXIT.OK;
    }

    // ── Help (fast) ───────────────────────────────────────────────────────
    if (route.kind === "help") {
      if (head === "help" || head === "--help" || head === "-h") {
        const topic = rest[0];
        if (topic === "--all" || topic === "-a") showHelp(undefined, { all: true });
        else showHelp(topic);
      } else {
        showHelp(undefined, { all: rest.includes("--all") || rest.includes("-a") });
      }
      return EXIT.OK;
    }
    // `xr <cmd> --help` — command help without booting the kernel.
    if (route.kind === "command-help" && route.command) {
      showCommandHelp(route.command);
      return EXIT.OK;
    }

    // ── Shell (fast, default) ─────────────────────────────────────────────
    if (route.kind === "shell") {
      const { runTUI } = await import("../interfaces/tui.ts"); // static literal
      await runTUI();
      return EXIT.OK;
    }

    // ── Serve (fast) ──────────────────────────────────────────────────────
    if (route.kind === "serve") {
      await runServeCommand(rest);
      return EXIT.OK;
    }

    // ── Registered command (lazy kernel boot, command-scoped profile) ────
    if (route.kind === "command" && route.command) {
      const regName = route.command;
      // Special: audit verify-log legacy was a top-level command that maps
      // to audit verify.
      let commandArgs = reinjectGlobalFlags(rest, flags);
      if (head === "verify-log") {
        commandArgs = reinjectGlobalFlags(["verify", ...rest], flags);
      }
      // Inject global mode/budget into run
      if (regName === "run") {
        commandArgs = injectRunOverrides(commandArgs, flags);
      }

      bootTrace.begin(regName);
      await withKernel(regName, flags, async (kernel) => {
        if (kernel.commands.has(regName)) {
          await kernel.executeCommand(regName, commandArgs, process.cwd());
          bootTrace.noteLoadedCommand(regName);
        } else {
          // Fallback: treat as run task (shouldn't happen for known regName)
          await kernel.executeCommand("run", injectRunOverrides(flags.args, flags), process.cwd());
        }
      });
      // Phase 0 · T11 — propagate the command's exit code. Returning EXIT.OK
      // unconditionally discarded every failure a command reported through
      // process.exitCode, so failed work exited 0.
      return currentExitCode();
    }

    /**
     * ── Default: free-form task → run ───────────────────────────────────────
     *
     * Phase 0 · T11 — one-word tasks must route to task mode.
     *
     * The rule is unambiguous: a RESERVED command name is a command;
     * everything else is a task. Near-miss typos get a suggestion as a
     * non-fatal hint printed alongside the task run — never a refusal.
     */
    if (route.kind === "task" && head) {
      const looksLikeSingleWord = rest.length === 0 && head.length < 24 && !head.includes(" ");
      if (looksLikeSingleWord) {
        const { didYouMean, editDistance } = await import("./output.ts");
        const suggestions = didYouMean(
          head,
          allAliasesAndNames().filter((n) => !n.startsWith("-")),
        );
        const nearest = suggestions[0];
        if (nearest && nearest !== head && editDistance(head.toLowerCase(), nearest.toLowerCase()) <= 2) {
          const { tip } = await import("./output.ts");
          tip(`Running "${head}" as a task. Did you mean the command \`xr ${nearest}\`?`);
        }
      }
    }

    // Free-form run
    bootTrace.begin("run");
    await withKernel("run", flags, async (kernel) => {
      const taskArgs = injectRunOverrides(flags.args, flags);
      if (!taskArgs.length) {
        throw usageError(
          "No task provided",
          'Pass a task: xr "your task"   or open the Shell: xr',
          ["xr help", "xr onboarding"],
        );
      }
      await kernel.executeCommand("run", taskArgs, process.cwd());
      bootTrace.noteLoadedCommand("run");
    });
    return currentExitCode();
  } catch (e) {
    if (e instanceof CliError && e.id === "unknown_command") {
      return EXIT.USAGE;
    }
    return handleFatal(e);
  }
}

/** For tests / programmatic use */
export { registryNameFor } from "./route-decision.ts";
