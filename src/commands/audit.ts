/**
 * XR — Audit command
 *
 * Canonical: xr audit [tail|verify|export|repair|anchor|export-key|re-key]
 * Legacy alias: xr verify-log → audit verify
 *
 * Phase 4 (Evidence Integrity, F-08):
 *   - xr audit verify [--crypto] [--anchor] [--crypto-legacy]
 *   - xr audit anchor            (push one signed checkpoint to the configured sink)
 *   - xr audit export-key <file> (encrypted backup of the Ed25519 private key)
 *   - xr audit re-key            (rotate the signing key; old segment stays verifiable)
 *
 * Spec: IA §1.2 Audit Entry, §5 CLI site map; docs/security/AUDIT-EVIDENCE.md
 */

import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { Store } from "../state/workspace-store.ts";
import { buildAuditReport } from "../export/report.ts";
import { loadAuditSigningKey, publicIdentityFromPrivate } from "../security/audit-signer.ts";
import { pushAnchor } from "../security/audit-anchor.ts";
import { loadConfig } from "../config/config.ts";
import {
  banner,
  heading,
  ok,
  warn,
  error,
  tip,
  table,
  emit,
  xrDim,
  xrCyan,
  xrGreen,
  xrRed,
  xrBold,
  statusMark,
} from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";

/** 0.2 Storage Unification: Always resolve from container, never create new Store(). */
function resolveStore(ctx: CommandContext): Store {
  return ctx.registry.resolve(Tokens.Store);
}

function parseLimit(args: string[], fallback = 30): number {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--limit" || args[i] === "-n") && args[i + 1]) {
      const n = Number.parseInt(args[i + 1]!, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (args[i]?.startsWith("--limit=")) {
      const n = Number.parseInt(args[i]!.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return fallback;
}

function flag(args: string[], ...names: string[]): boolean {
  return args.some((a) => names.includes(a));
}

/** Non-interactive passphrase (tests / automation): XR_AUDIT_KEY_PASSPHRASE. */
function passphraseFromEnv(): string | null {
  const p = process.env.XR_AUDIT_KEY_PASSPHRASE;
  return p && p.length >= 8 ? p : null;
}

function promptPassphrase(confirm: boolean): string | null {
  const nonInteractive = passphraseFromEnv();
  if (nonInteractive) return nonInteractive;
  // Bun provides a hidden TTY prompt via Bun.password when a TTY is present.
  if (typeof Bun !== "undefined" && typeof (Bun as any).password?.prompt === "function") {
    try {
      const p1 = (Bun as any).password.prompt("Passphrase (min 8 chars, hidden): ");
      if (!p1 || p1.length < 8) {
        warn("Passphrase must be at least 8 characters.");
        return null;
      }
      if (confirm) {
        const p2 = (Bun as any).password.prompt("Confirm passphrase: ");
        if (p1 !== p2) {
          warn("Passphrases do not match.");
          return null;
        }
      }
      return p1;
    } catch {
      return null;
    }
  }
  warn("No TTY for a hidden passphrase; set XR_AUDIT_KEY_PASSPHRASE for non-interactive use.");
  return null;
}

const KEY_FILE_MAGIC = "xr-audit-key-v1";

function sealKey(privateKeyB64: string, passphrase: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(privateKeyB64, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    KEY_FILE_MAGIC,
    salt.toString("base64"),
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(".");
}

export class AuditCommand implements Command {
  name = "audit";
  description = "tamper-evident + signed audit log: tail, verify, export, repair, anchor, re-key";
  usage =
    "xr audit [tail|verify|export|repair|anchor|export-key|re-key] [--crypto] [--anchor] [--crypto-legacy] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const store = resolveStore(ctx);
    const sub = (ctx.args[0] ?? "tail").toLowerCase();
    const rest = ctx.args.slice(1);

    switch (sub) {
      case "tail":
      case "list":
      case "ls":
        return this.tail(store, rest);
      case "verify":
      case "check":
      case "status":
        return this.verify(store, rest);
      case "export":
        return this.export(store, rest);
      case "repair":
        return this.repair(store, ctx.args);
      case "anchor":
        return this.anchor(store, rest);
      case "export-key":
      case "exportkey":
        return this.exportKey(store, rest);
      case "re-key":
      case "rekey":
        return this.reKey(store, rest);
      case "help":
      case "--help":
      case "-h":
        this.printHelp();
        return;
      default:
        if (sub.startsWith("-")) {
          return this.tail(store, ctx.args);
        }
        throw usageError(
          `Unknown audit subcommand: ${sub}`,
          "Use: xr audit tail | verify | export | repair | anchor | export-key | re-key",
          ["xr audit --help", "xr shield status"],
        );
    }
  }

  private printHelp(): void {
    banner();
    heading("Audit");
    console.log(`  ${xrDim("Evidence (all local-first, offline-capable):")}`);
    console.log(`  ${xrCyan("xr audit tail [--limit n]")}   recent entries`);
    console.log(`  ${xrCyan("xr audit verify")}              verify SHA-256 hash chain (tamper-evident)`);
    console.log(`  ${xrCyan("xr audit verify --crypto")}     chain + Ed25519 head signature + counters (tamper-resistant)`);
    console.log(`  ${xrCyan("xr audit verify --crypto --anchor")}  also append-verify remote anchors`);
    console.log(`  ${xrCyan("xr audit verify --crypto-legacy")}  accept an unsigned (pre-keying) chain`);
    console.log();
    console.log(`  ${xrDim("Maintenance:")}`);
    console.log(`  ${xrCyan("xr audit export [path]")}       signed markdown report`);
    console.log(`  ${xrCyan("xr audit repair [--yes]")}      truncate suspect entries at the first broken link`);
    console.log(`  ${xrCyan("xr audit anchor")}              push one signed checkpoint to the configured sink`);
    console.log(`  ${xrCyan("xr audit export-key <file>")}   encrypted backup of the signing key (passphrase)`);
    console.log(`  ${xrCyan("xr audit re-key")}              rotate the signing key (old segment stays verifiable)`);
    console.log();
    tip("Legacy: xr verify-log → xr audit verify · Threat model: docs/security/AUDIT-EVIDENCE.md");
    console.log();
  }

  /**
   * Phase 1 (T1): explicit chain repair. Destructive — requires --yes.
   * Truncates suspect entries from the first broken link and re-seeds the
   * chain with an audited repair event. Nothing intact is ever rewritten.
   */
  private repair(store: Store, args: string[]): void {
    const status = store.verifyChain();
    if (status.valid) {
      emit(
        { ok: true, repaired: false, reason: "chain already intact" },
        () => {
          ok("Audit chain is intact — nothing to repair.");
          console.log(`  ${xrDim(`${store.auditCount()} entries verified · SHA-256 hash chain`)}`);
        },
      );
      return;
    }
    const confirmed = args.includes("--yes") || args.includes("-y");
    if (!confirmed) {
      warn(
        `The chain is broken at entry ${status.brokenAt}. ` +
          `Repair truncates entries from id ${status.brokenAt} onward (they cannot be trusted) and re-seeds the chain. ` +
          `This cannot be undone except from a backup. Re-run with --yes to confirm.`,
      );
      process.exitCode = 1;
      return;
    }
    const result = store.repairChain();
    emit(
      { ok: true, repaired: true, brokenAt: result.brokenAt, removed: result.removed, hash: result.hash },
      () => {
        banner();
        ok(`Audit chain repaired: truncated ${result.removed} suspect entries from id ${result.brokenAt}.`);
        console.log(`  ${xrDim("A re-seeding audit.repair event was chained to the intact prefix.")}`);
        tip("Verify with: xr audit verify --crypto");
      },
    );
  }

  private tail(store: Store, args: string[]): void {
    const limit = parseLimit(args, 30);
    const entries = store.recentAudit(limit);
    const chain = store.verifyChain();

    emit(
      {
        ok: true,
        chainValid: chain.valid,
        brokenAt: chain.brokenAt,
        keyed: store.auditIsKeyed,
        count: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          event: e.event,
          hash: e.hash,
          sessionId: e.session_id ?? null,
          createdAt: e.created_at,
          detail: safeParse(e.detail),
        })),
      },
      () => {
        banner();
        console.log(
          `  ${xrBold("Audit log")}  ${chain.valid ? xrGreen("chain intact ✓") : xrRed("chain BROKEN ✗")}` +
            `${store.auditIsKeyed ? xrDim("  · Ed25519-signed") : xrDim("  · unsigned (chain-only)")}`,
        );
        console.log(`  ${xrDim(`Showing ${entries.length} newest · total ${store.auditCount()}`)}\n`);

        if (!entries.length) {
          console.log(`  ${xrDim("No audit entries yet. Run a task to produce the first record.")}\n`);
          return;
        }

        const rows = entries.map((e) => {
          const t = new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19);
          const signed = e.event === "audit.keyed" || e.event === "audit.rekey";
          return [String(e.id), t, e.event, e.hash.slice(0, 12) + "…", signed ? "🔏" : ""];
        });
        table(["id", "time (UTC)", "event", "hash", ""], rows, {
          widths: [6, 20, 22, 16, 3],
        });
        console.log();
        tip("xr audit verify --crypto   ·   xr audit export");
        console.log();
      },
    );
  }

  /**
   * Phase 4 (F-08): verification.
   *  - default:   chain replay only (tamper-evident; the pre-existing behaviour)
   *  - --crypto:  chain + Ed25519 signatures + counter monotonicity + head
   *  - --anchor:  also append-verify remote anchor records
   *  - --crypto-legacy: accept an entirely unsigned (pre-keying) chain.
   *
   * Exit codes (automation-friendly):
   *   0 = verified (or legacy-unsigned explicitly accepted)
   *   1 = tampering / integrity failure (chain, signature, counter, or head)
   *   2 = key unavailable on a keyed install → verification limited to chain
   */
  private verify(store: Store, args: string[]): void {
    const crypto = flag(args, "--crypto");
    const anchor = flag(args, "--anchor");
    const legacyOk = flag(args, "--crypto-legacy");

    const chain = store.verifyChain();
    const count = store.auditCount();

    if (!crypto) {
      // Classic chain-only verification (unchanged contract + exit code).
      emit(
        { ok: chain.valid, valid: chain.valid, brokenAt: chain.brokenAt ?? null, entries: count },
        () => {
          banner();
          if (chain.valid) {
            console.log(`  ${statusMark("ok")} ${xrBold(xrGreen("Audit chain intact"))}`);
            console.log(`  ${xrDim(`${count} entries verified · SHA-256 hash chain`)}`);
            if (!store.auditIsKeyed) {
              tip("This install is not yet keyed. Ed25519 head signing activates on next boot — see `xr audit verify --crypto`.");
            } else {
              tip("Add --crypto to verify Ed25519 signatures (tamper-RESISTANT), not just the hash chain.");
            }
          } else {
            this.printChainBroken(chain.brokenAt);
          }
          console.log();
        },
      );
      if (!chain.valid) process.exitCode = 1;
      return;
    }

    // ── Cryptographic verification ──────────────────────────────────────────
    const cryptoResult = store.verifyCrypto();
    const anchorResult = anchor ? store.verifyAnchors() : null;

    // Determine overall status + exit code.
    let exitCode = 0;
    const integrityFailure = !cryptoResult.chainValid || !cryptoResult.signaturesValid;
    const keyMissingOnKeyed = cryptoResult.keyed && !cryptoResult.keyAvailable;

    if (integrityFailure) {
      exitCode = 1;
    } else if (keyMissingOnKeyed) {
      // Keyed chain, signatures that CAN be checked all verify, but the
      // private key is unavailable in this environment → evidence is limited
      // to the signed prefix + chain (the honest code-2 state).
      exitCode = 2;
    } else if (!cryptoResult.keyed && !legacyOk) {
      // Fully unsigned chain: honest limited scope, but not a failure.
      exitCode = 0;
    }

    const firstTs = store.auditChainRange({ limit: 1 })[0];
    const lastRow = store.recentAudit(1)[0];

    emit(
      {
        ok: exitCode === 0,
        exitCode,
        chainValid: cryptoResult.chainValid,
        keyed: cryptoResult.keyed,
        keyAvailable: cryptoResult.keyAvailable,
        signaturesValid: cryptoResult.signaturesValid,
        counterError: cryptoResult.counterError ?? null,
        head: cryptoResult.head ?? null,
        segments: cryptoResult.segments.length,
        anchors: anchorResult
          ? {
              verified: anchorResult.verified,
              failed: anchorResult.failed,
              highestCounter: anchorResult.highestCounter,
              anchorLag: anchorResult.anchorLag,
            }
          : null,
        entries: count,
        firstTs: firstTs?.created_at ?? null,
        lastTs: lastRow?.created_at ?? null,
      },
      () => {
        banner();
        console.log(`  ${xrBold("Audit evidence verification")}\n`);

        // Chain
        console.log(
          `  ${statusMark(cryptoResult.chainValid ? "ok" : "error")} SHA-256 chain replay` +
            `  ${xrDim(`${count} entries`)}`,
        );
        if (!cryptoResult.chainValid) this.printChainBroken(undefined, "    ");

        if (!cryptoResult.keyed) {
          console.log(`  ${statusMark(legacyOk ? "ok" : "warn")} Ed25519 signing` +
            `  ${xrDim(legacyOk ? "not keyed — accepted via --crypto-legacy (chain-only evidence)" : "not keyed yet — evidence is chain-only; keying activates on next boot")}`);
        } else {
          // Signatures
          console.log(
            `  ${statusMark(cryptoResult.signaturesValid ? "ok" : "error")} Ed25519 signatures & counters` +
              `  ${xrDim(`${cryptoResult.segments.length} segment(s)`)}`,
          );
          if (cryptoResult.counterError) {
            console.log(`      ${xrRed(`✗ ${cryptoResult.counterError.reason} at entry id ${cryptoResult.counterError.atId}`)}`);
          }
          // Key availability
          if (keyMissingOnKeyed && !integrityFailure) {
            console.log(
              `  ${statusMark("warn")} signing key unavailable` +
                `  ${xrDim("private key not loadable in this environment — existing signatures verified, but new appends cannot be signed")}`,
            );
          }
          // Head
          const h = cryptoResult.head;
          if (h?.present) {
            const headOk = h.matches && !h.stale;
            console.log(
              `  ${statusMark(headOk ? "ok" : "error")} signed head` +
                `  ${xrDim(`counter ${h.counter} · entry ${h.entryId}`) + (headOk ? xrGreen(" ✓") : xrRed(` ✗ ${h.stale ? "stale" : "bad signature"}`))}`,
            );
          } else {
            console.log(`  ${statusMark("error")} signed head  ${xrDim("missing — a rebuilt/forged chain cannot restore it")}`);
          }
        }

        // Anchors
        if (anchorResult) {
          const anchorOk = anchorResult.failed.length === 0;
          console.log(
            `  ${statusMark(anchorOk ? "ok" : "error")} remote anchors` +
              `  ${xrDim(`${anchorResult.verified} verified · highest counter ${anchorResult.highestCounter ?? "—"}` +
                (anchorResult.anchorLag ? " · local chain is AHEAD of last anchor (expected)" : ""))}`,
          );
          for (const f of anchorResult.failed) {
            console.log(`      ${xrRed(`✗ counter ${f.counter}: ${f.reason}`)}`);
          }
        }

        console.log();
        if (exitCode === 0) {
          ok(cryptoResult.keyed
            ? "Evidence verified: tamper-evident (chain) and tamper-resistant (signed)."
            : "Chain verified (tamper-evident). Signing activates on next boot for tamper-resistance.");
        } else if (exitCode === 2) {
          warn("Verification LIMITED to the hash chain: the signing key is unavailable. Locate/restore the key or re-key.");
        } else {
          console.log(`  ${xrBold(xrRed("Evidence integrity FAILED."))}  ${xrDim("History may have been tampered with. Export for forensics before any repair.")}`);
          tip("xr audit export   (preserve evidence)  ·  docs/security/AUDIT-EVIDENCE.md");
        }
        console.log();
      },
    );

    process.exitCode = exitCode;
  }

  private printChainBroken(brokenAt?: number, indent = "  "): void {
    console.log(
      `${indent}${xrDim(`Integrity failure${brokenAt ? ` at entry id ${brokenAt}` : ""}. A hash link does not match the recomputed value.`)}`,
    );
    console.log(`${indent}${xrDim("Do not trust this log for compliance until investigated.")}`);
  }

  private export(store: Store, args: string[]): void {
    const limit = parseLimit(args, 500);
    const outPath =
      args.find((a) => !a.startsWith("-") && a !== "export") ??
      join(process.cwd(), `xr-audit-${Date.now()}.md`);

    const chain = store.verifyChain();
    const entries = store.recentAudit(limit).map((e) => ({
      event: e.event,
      detail: e.detail,
      hash: e.hash,
      created_at: e.created_at,
    }));

    const report = buildAuditReport({
      project: process.cwd(),
      chainValid: chain.valid,
      entries,
    });

    writeFileSync(outPath, report.markdown, "utf8");

    emit(
      {
        ok: true,
        path: outPath,
        sha256: report.sha256,
        chainValid: chain.valid,
        keyed: store.auditIsKeyed,
        entries: entries.length,
      },
      () => {
        ok(`Exported signed audit report`, outPath);
        console.log(`  ${xrDim("sha256")}  ${report.sha256}`);
        console.log(
          `  ${xrDim("chain")}   ${chain.valid ? xrGreen("intact") : xrRed("broken")}`,
        );
        console.log();
      },
    );
  }

  /**
   * Phase 4 (F-08): push one signed checkpoint to the configured anchor sink.
   * Egress-gated and fail-safe (a blocked/failed push is reported, never fatal).
   */
  private async anchor(store: Store, _args: string[]): Promise<void> {
    const cfg = loadConfig().config;
    const anchorCfg = cfg.audit?.anchor;
    if (!anchorCfg?.enabled || !anchorCfg.sink) {
      emit(
        { ok: false, reason: "anchor disabled" },
        () => {
          warn("Remote anchor is disabled. Configure audit.anchor.{enabled,sink} to opt in.");
          tip("The anchor is egress-gated: an https sink must also be on security.egressAllowlist.");
          console.log();
        },
      );
      process.exitCode = 0; // not an error — anchoring is optional
      return;
    }
    const result = await pushAnchor(store, { config: cfg, force: true });
    emit(
      { ...result },
      () => {
        banner();
        if (result.ok) {
          ok(`Anchored signed checkpoint ${result.counter ?? ""} → ${result.sink}`);
          console.log(`  ${xrDim(`sink kind: ${result.kind}`)}`);
        } else if (result.kind === "blocked") {
          warn(`Anchor refused (fail-safe, run continues): ${result.reason}`);
          tip("Add the sink host to security.egressAllowlist / allowedHosts, or use a file:// sink.");
        } else {
          warn(`Anchor not pushed: ${result.reason ?? result.kind}`);
        }
        console.log();
      },
    );
    // Blocked/failed anchor is NOT an integrity failure — keep exit 0.
  }

  /**
   * Phase 4 (F-08): encrypted backup of the Ed25519 signing key (PEM-style sealed
   * file, AES-256-GCM under a scrypt-derived passphrase). Recovery path for key
   * loss. The key is never printed.
   */
  private exportKey(store: Store, args: string[]): void {
    const outPath =
      args.find((a) => !a.startsWith("-") && a !== "export-key" && a !== "exportkey") ??
      join(process.cwd(), `xr-audit-key-${Date.now()}.key`);
    if (existsSync(outPath)) {
      emit({ ok: false, error: "refusing to overwrite an existing key file" }, () => {
        error(`Refusing to overwrite existing file: ${outPath}`);
      });
      process.exitCode = 1;
      return;
    }
    const priv = loadAuditSigningKey();
    if (!priv) {
      emit({ ok: false, error: "no signing key" }, () => {
        warn("No audit signing key is installed on this machine.");
        tip("Keying happens automatically on boot. Run any XR command once, then retry.");
      });
      process.exitCode = 2;
      return;
    }
    const passphrase = promptPassphrase(true);
    if (!passphrase) {
      process.exitCode = 1;
      return;
    }
    const pub = publicIdentityFromPrivate(priv);
    const sealed = sealKey(priv, passphrase);
    const body =
      `# XR audit signing key backup — KEEP SECRET\n` +
      `# pubkey: ${pub.publicKeyB64}\n` +
      `# fingerprint: ${pub.publicKeyFingerprint}\n` +
      `# created: ${new Date().toISOString()}\n` +
      `${sealed}\n`;
    writeFileSync(outPath, body, { mode: 0o600 });
    emit(
      { ok: true, path: outPath, fingerprint: pub.publicKeyFingerprint },
      () => {
        ok(`Exported encrypted signing key`, outPath);
        console.log(`  ${xrDim("fingerprint")}  ${pub.publicKeyFingerprint}`);
        warn("This file unlocks audit signing for this install. Store it offline (password manager / safe).");
      },
    );
  }

  /**
   * Phase 4 (F-08): rotate the signing key. Appends an audited `audit.rekey`
   * event; the previous segment remains verifiable up to (and including) the
   * re-key point under the old key.
   */
  private reKey(store: Store, args: string[]): void {
    const confirmed = args.includes("--yes") || args.includes("-y");
    if (!confirmed) {
      warn(
        "re-key rotates the Ed25519 audit signing key. The old segment stays verifiable up to the re-key point; " +
          "evidence after it is signed by the new key. Re-run with --yes to confirm.",
      );
      process.exitCode = 1;
      return;
    }
    const result = store.rekeyAudit("operator");
    emit(
      { ok: result.ok, pubkey: result.pubkey ?? null, fingerprint: result.fingerprint ?? null, error: result.error ?? null },
      () => {
        if (result.ok) {
          ok(`Audit signing key rotated. New fingerprint: ${result.fingerprint}`);
          console.log(`  ${xrDim("An audited audit.rekey event was chained; the old segment remains verifiable.")}`);
          tip("Back up the new key: xr audit export-key <file>");
        } else {
          error(`Re-key failed: ${result.error ?? "unknown error"}`);
        }
        console.log();
      },
    );
    if (!result.ok) process.exitCode = 1;
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
