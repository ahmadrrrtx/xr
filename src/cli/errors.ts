/**
 * XR 3.1C — CLI error types
 *
 * Errors explain: What happened · Why · How to fix.
 * Never print raw stack traces for normal users (XR_DEBUG=1 / --debug only).
 */

import { EXIT, type ExitCode } from "./flags.ts";
import { printError, type CliErrorShape, isVerbose } from "./output.ts";

export class CliError extends Error {
  readonly id: string;
  readonly why?: string;
  readonly fix?: string | string[];
  readonly related?: string[];
  readonly exitCode: ExitCode;
  readonly detail?: string;

  constructor(shape: CliErrorShape & { message?: string }) {
    super(shape.what ?? shape.message ?? "Something went wrong");
    this.name = "CliError";
    this.id = shape.id ?? "error";
    this.why = shape.why;
    this.fix = shape.fix;
    this.related = shape.related;
    this.exitCode = (shape.code as ExitCode) ?? EXIT.ERROR;
    this.detail = shape.detail;
  }

  toShape(): CliErrorShape {
    return {
      what: this.message,
      why: this.why,
      fix: this.fix,
      related: this.related,
      code: this.exitCode,
      id: this.id,
      detail: this.detail,
    };
  }
}

export function usageError(what: string, fix?: string, related?: string[]): CliError {
  return new CliError({
    id: "usage",
    what,
    why: "The command was called with missing or invalid arguments.",
    fix: fix ?? "Run with --help to see usage.",
    related,
    code: EXIT.USAGE,
  });
}

export function notFoundError(kind: string, id: string, related?: string[]): CliError {
  return new CliError({
    id: "not_found",
    what: `${kind} not found: ${id}`,
    why: `No ${kind.toLowerCase()} matches that identifier in the active workspace.`,
    fix: [
      `List available items, then retry with a valid id.`,
      related?.[0] ? `Try: ${related[0]}` : "Check spelling or create it first.",
    ],
    related,
    code: EXIT.NOT_FOUND,
  });
}

export function deniedError(what: string, why?: string): CliError {
  return new CliError({
    id: "denied",
    what,
    why: why ?? "Security policy or approval gate blocked this action.",
    fix: "Review xr shield status and approval settings, then retry if intended.",
    related: ["xr shield status", "xr audit tail"],
    code: EXIT.DENIED,
  });
}

export function networkError(what: string, detail?: string): CliError {
  return new CliError({
    id: "network",
    what,
    why: "A provider or network endpoint was unreachable or rejected the request.",
    fix: [
      "Check connectivity and API keys: xr providers test",
      "For local models: ensure Ollama (or your runtime) is running",
    ],
    related: ["xr providers test", "xr doctor --network"],
    code: EXIT.NETWORK,
    detail,
  });
}

/**
 * Render any thrown value as a professional CLI error and return exit code.
 */
export function handleFatal(err: unknown): ExitCode {
  if (err instanceof CliError) {
    printError(err.toShape());
    return err.exitCode;
  }

  if (err instanceof Error) {
    const msg = err.message || "Unexpected error";
    // Soft-map common patterns
    if (/unknown command/i.test(msg)) {
      printError({
        id: "unknown_command",
        what: msg,
        why: "That name is not a registered XR command or alias.",
        fix: "Run xr help to see available commands.",
        related: ["xr help"],
        code: EXIT.USAGE,
        detail: isVerbose() ? err.stack : undefined,
      });
      return EXIT.USAGE;
    }
    if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(msg)) {
      printError({
        id: "network",
        what: msg,
        why: "Network or provider connection failed.",
        fix: "xr providers test · xr doctor --network",
        related: ["xr providers test"],
        code: EXIT.NETWORK,
        detail: isVerbose() ? err.stack : undefined,
      });
      return EXIT.NETWORK;
    }

    printError({
      id: "fatal",
      what: msg,
      why: "An unexpected error occurred while running XR.",
      fix: [
        "Retry the command.",
        "If it persists: xr doctor",
        "For a stack trace: XR_DEBUG=1 xr …",
      ],
      related: ["xr doctor", "xr help"],
      code: EXIT.ERROR,
      detail: isVerbose() || process.env.XR_DEBUG === "1" ? err.stack : undefined,
    });
    return EXIT.ERROR;
  }

  printError({
    id: "fatal",
    what: String(err),
    code: EXIT.ERROR,
  });
  return EXIT.ERROR;
}
