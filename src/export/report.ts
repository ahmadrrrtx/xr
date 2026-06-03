/**
 * XR — signed audit/benchmark export.
 * A shareable, verifiable proof artifact: "here is exactly what the AI did to
 * your codebase, and here is a hash so you can prove it wasn't altered."
 * Outputs Markdown (printable to PDF) + a SHA-256 signature over the content.
 */
import { createHash } from "node:crypto";

export interface AuditEntry {
  event: string;
  detail: string;
  hash: string;
  created_at: number;
}

export interface ExportInput {
  project: string;
  chainValid: boolean;
  entries: AuditEntry[];
  blockRate?: number;
  totalUsd?: number;
}

export interface SignedExport {
  markdown: string;
  sha256: string;
}

export function buildAuditReport(input: ExportInput): SignedExport {
  const lines: string[] = [];
  lines.push(`# XR Audit Report — ${input.project}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`- Hash chain: ${input.chainValid ? "✅ INTACT (tamper-evident)" : "❌ BROKEN"}`);
  if (input.blockRate !== undefined)
    lines.push(`- Injection block-rate: ${Math.round(input.blockRate * 100)}%`);
  if (input.totalUsd !== undefined) lines.push(`- Total spend: $${input.totalUsd.toFixed(4)}`);
  lines.push(`- Entries: ${input.entries.length}`);
  lines.push("");
  lines.push("## Action log (newest first)");
  lines.push("");
  lines.push("| time (UTC) | event | hash |");
  lines.push("|---|---|---|");
  for (const e of input.entries) {
    const t = new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19);
    lines.push(`| ${t} | ${e.event} | \`${e.hash.slice(0, 16)}…\` |`);
  }
  lines.push("");
  lines.push("---");
  lines.push("_Every entry is linked in a SHA-256 hash chain. Re-run `xr verify-log` to confirm integrity._");

  const markdown = lines.join("\n");
  const sha256 = createHash("sha256").update(markdown).digest("hex");
  const withSig = markdown + `\n\n<!-- xr-signature: ${sha256} -->\n`;
  return { markdown: withSig, sha256 };
}

/** Verify a previously-exported report wasn't altered. */
export function verifyAuditReport(reportText: string): { valid: boolean; sha256?: string } {
  const m = reportText.match(/<!-- xr-signature: ([a-f0-9]{64}) -->/);
  if (!m) return { valid: false };
  const sig = m[1];
  const body = reportText.replace(/\n\n<!-- xr-signature: [a-f0-9]{64} -->\n?$/, "");
  const recomputed = createHash("sha256").update(body).digest("hex");
  return { valid: recomputed === sig, sha256: sig };
}
