/**
 * XR Phase 4 · T2 — guarantee-matrix generator.
 *
 * Generates the per-OS / per-action isolation guarantee matrix FROM LIVE
 * PROBES of the host (EnvironmentManager backend detection) — never from
 * prose. The matrix states exactly what each placement enforces (or does
 * not), per action class, on the CURRENT host, so no unsupported claim can
 * creep in (Art. IX.4 / XIX: no claim without evidence).
 *
 * Outputs:
 *   · console (human table)             — `bun run scripts/guarantee-matrix.ts`
 *   · docs/security/GUARANTEE_MATRIX.md — `--write`
 *   · JSON (machine)                    — `--json`
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { EnvironmentManager } from "../src/runtime/trust/environment/manager.ts";
import { InProcessBackend } from "../src/runtime/trust/environment/in-process.ts";
import { RestrictedProcessBackend } from "../src/runtime/trust/environment/restricted-process.ts";
import { NamespaceSandboxBackend } from "../src/runtime/trust/environment/namespace.ts";
import { ContainerBackend } from "../src/runtime/trust/environment/container.ts";
import { GVisorBackend } from "../src/runtime/trust/environment/gvisor.ts";
import { FirecrackerBackend } from "../src/runtime/trust/environment/firecracker.ts";
import { decidePlacementForTier } from "../src/runtime/trust/policy.ts";

export interface MatrixRow {
  actionClass: string;
  riskTier: "tier0_in_process" | "tier1_restricted" | "tier2_isolated";
  /** Placement actually selected on THIS host (from live probes). */
  placement: string;
  kernelBoundary: boolean;
  enforcedFilesystem: boolean;
  enforcedNetwork: boolean;
  enforcedProcess: boolean;
  noAmbientAuthority: boolean;
  /** True when the action class FAILS CLOSED on this host (no backend). */
  failClosed: boolean;
}

export async function buildMatrix(): Promise<{ os: string; arch: string; isRoot: boolean; rows: MatrixRow[]; backends: Array<{ id: string; available: boolean }> }> {
  const broker = await import("../src/runtime/trust/credentials.ts").then((m) => new m.CredentialBroker());
  const manager = new EnvironmentManager(
    [
      new InProcessBackend(),
      new RestrictedProcessBackend(),
      new NamespaceSandboxBackend(),
      new ContainerBackend(),
      new GVisorBackend(),
      new FirecrackerBackend(),
    ],
    broker,
  );
  await manager.init();
  const caps = manager.capabilities();

  const actionClasses: Array<{ name: string; tier: "tier0_in_process" | "tier1_restricted" | "tier2_isolated" }> = [
    { name: "read / list in-workspace", tier: "tier0_in_process" },
    { name: "in-workspace write", tier: "tier1_restricted" },
    { name: "network fetch (allow-listed)", tier: "tier1_restricted" },
    { name: "git mutation", tier: "tier1_restricted" },
    { name: "shell / arbitrary code", tier: "tier2_isolated" },
    { name: "plugin (untrusted)", tier: "tier2_isolated" },
    { name: "MCP stdio server", tier: "tier2_isolated" },
    { name: "browser", tier: "tier2_isolated" },
  ];

  const rows: MatrixRow[] = [];
  for (const ac of actionClasses) {
    const decision = decidePlacementForTier(ac.tier, caps, { hardened: true });
    const placement =
      decision.kind === "admitted" ? decision.placement :
      decision.kind === "in_process_ok" ? "in_process" :
      "BLOCKED (fail-closed)";
    const backend = placement === "BLOCKED (fail-closed)" ? undefined : manager.backendFor(placement as never);
    rows.push({
      actionClass: ac.name,
      riskTier: ac.tier,
      placement,
      kernelBoundary: backend?.guarantees.kernelBoundary ?? false,
      enforcedFilesystem: backend?.guarantees.enforcedFilesystem ?? false,
      enforcedNetwork: backend?.guarantees.enforcedNetwork ?? false,
      enforcedProcess: backend?.guarantees.enforcedProcess ?? false,
      noAmbientAuthority: backend?.guarantees.noAmbientAuthority ?? false,
      failClosed: decision.kind === "blocked",
    });
  }

  return {
    os: platform(),
    arch: process.arch,
    isRoot: process.getuid?.() === 0,
    rows,
    backends: manager.listBackends().map((b) => ({ id: b.id, available: b.available })),
  };
}

function renderMarkdown(m: Awaited<ReturnType<typeof buildMatrix>>): string {
  const lines: string[] = [];
  lines.push(`# XR — Per-OS / Per-Action Isolation Guarantee Matrix`);
  lines.push(``);
  lines.push(`> **Generated from live host probes** — \`bun run scripts/guarantee-matrix.ts\`. `);
  lines.push(`> This document is a machine output, not prose; it regenerates on every run.`);
  lines.push(`> It is a SNAPSHOT OF THE HOST THAT LAST RAN \`--write\`: rows are per-host by design`);
  lines.push(`> (a host with Docker selects \`container\`; one without selects \`namespace_sandbox\` or`);
  lines.push(`> fails closed). CI validates the generator and this document's structure, not cross-host`);
  lines.push(`> row equality. Language follows the Constitution: "data scope" ≠ "security isolation";`);
  lines.push(`> only OS-level boundaries are called boundaries.`);
  lines.push(``);
  lines.push(`**Host:** \`${m.os}/${m.arch}\` · **root:** \`${m.isRoot}\` · **hardened mode:** on (fail-closed)`);
  lines.push(``);
  lines.push(`## Isolation backends detected on this host`);
  lines.push(``);
  lines.push(`| Backend | Available |`);
  lines.push(`|---|---|`);
  for (const b of m.backends) lines.push(`| \`${b.id}\` | ${b.available ? "✅" : "❌ (fail-closed if required)"} |`);
  lines.push(``);
  lines.push(`## Guarantees per action class (what IS enforced on this host)`);
  lines.push(``);
  lines.push(`| Action class | Risk tier | Placement | Kernel boundary | FS enforced | Network enforced | Process enforced | No ambient authority | Fail-closed |`);
  lines.push(`|---|---|---|---|---|---|---|---|---|`);
  for (const r of m.rows) {
    lines.push(
      `| ${r.actionClass} | ${r.riskTier} | \`${r.placement}\` | ${r.kernelBoundary ? "✅" : "❌"} | ${r.enforcedFilesystem ? "✅" : "❌"} | ${r.enforcedNetwork ? "✅" : "❌"} | ${r.enforcedProcess ? "✅" : "❌"} | ${r.noAmbientAuthority ? "✅" : "❌"} | ${r.failClosed ? "✅" : "—"} |`,
    );
  }
  lines.push(``);
  lines.push(`## Honest limitations`);
  lines.push(``);
  lines.push(`- A placement without a kernel boundary (in-process / restricted-process) is **not** isolation; it is policy + defense-in-depth.`);
  lines.push(`- \`namespace_sandbox\` may be bubblewrap **or** raw user namespaces; the raw-unshare fallback hides sensitive paths but does not pivot the root (documented in the backend's \`describe()\`).`);
  lines.push(`- gVisor/Firecracker are selected only when the runtime is actually present; otherwise the next-strongest tier-adequate backend is used or the action fails closed.`);
  lines.push(`- macOS/Windows backends (Seatbelt/containers) are NOT validated in this phase — no claim is made for them; see KNOWN_LIMITATIONS.md.`);
  lines.push(`- \`node:vm\` is defense-in-depth inside the plugin worker, never a security boundary (T8).`);
  lines.push(``);
  return lines.join("\n");
}

const here = dirname(fileURLToPath(import.meta.url));

if (import.meta.main) {
  const args = process.argv.slice(2);
  const m = await buildMatrix();
  if (args.includes("--json")) {
    console.log(JSON.stringify(m, null, 2));
  } else if (args.includes("--write")) {
    const out = join(here, "..", "docs", "security", "GUARANTEE_MATRIX.md");
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, renderMarkdown(m));
    console.log(`wrote ${out}`);
  } else {
    console.log(renderMarkdown(m));
  }
}
