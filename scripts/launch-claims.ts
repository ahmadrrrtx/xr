/**
 * XR-LAUNCH-010 — claim-lint gates 8 and 9 (owner decision D2, 2026-10-22).
 *
 *   8. STATUS LABEL   — the release label is "Public beta" until every gate in
 *                       docs/release/launch-gates.json is green. While the label
 *                       is not stable, public surfaces may not use stable-
 *                       production wording; the label may not become "stable"
 *                       while any gate is open.
 *   9. CHANNEL CLAIMS — every row of the README install table maps to a known
 *                       channel, uses one of the two legends (✅ live / ⏳ …),
 *                       and a row marked live is a channel the manifest claims.
 *                       With `--live` the table is compared with what
 *                       `channel:live` reports from the real registries: a row
 *                       that says live for a failing channel is a violation.
 *  10. VS CODE LISTING — (XR-LAUNCH-034) until the extension is listed, the
 *                       README labels it "preview — install the .vsix from
 *                       Releases", and no public surface claims a Marketplace
 *                       or Open VSX listing.
 *
 * Kept out of claim-lint.ts so the scanner stays readable; claim-lint imports it.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ChannelId, ReleaseManifest } from "./release-manifest.ts";

export interface LaunchViolation {
  gate: "status-label" | "channel-claim" | "vscode-listing";
  file: string;
  line: number;
  text: string;
  reason: string;
}

export const LAUNCH_GATES_PATH = "docs/release/launch-gates.json";

interface LaunchGate {
  id: string;
  title: string;
  status: "open" | "in-progress" | "fixed-unverified" | "green";
  evidence: string;
}

/** Wording that asserts a production-grade release. Disclaimers are allowed. */
const STABLE_WORDING: RegExp[] = [
  /status:\s*\**\s*stable\b/i,
  /\bproduction[- ]ready\b/i,
  /\bgenerally available\b/i,
  /\bproduction line\b/i,
];
const WORDING_DISCLAIMER = /\b(not|until|before|no longer|isn't|is not|yet)\b/i;

/** Public surfaces that carry the release label. */
function labelSurfaces(root: string): string[] {
  const out = ["README.md", "docs/release/SUPPORT_MATRIX.md", "docs/release/CHANNELS.md", "docs/development/GETTING_STARTED.md"]
    .map((p) => join(root, p))
    .filter((p) => existsSync(p));
  const site = join(root, "website", "src");
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|mdx?)$/.test(name) && !name.endsWith(".generated.ts")) out.push(p);
    }
  };
  walk(site);
  return out;
}

export function lintStatusLabel(manifest: ReleaseManifest, root: string): LaunchViolation[] {
  const out: LaunchViolation[] = [];
  const stability = manifest.identity.stability ?? "stable";
  let gates: LaunchGate[] = [];
  try {
    gates = (JSON.parse(readFileSync(join(root, LAUNCH_GATES_PATH), "utf8")) as { gates: LaunchGate[] }).gates;
    if (!Array.isArray(gates) || gates.length === 0) throw new Error("no gates");
  } catch (err) {
    return [{ gate: "status-label", file: LAUNCH_GATES_PATH, line: 0, text: "", reason: `unreadable launch-gate file (fail closed): ${err instanceof Error ? err.message : String(err)}` }];
  }
  if (stability === "stable") {
    const notGreen = gates.filter((g) => g.status !== "green" || !g.evidence.trim());
    if (notGreen.length > 0) {
      out.push({
        gate: "status-label",
        file: "release.manifest.json",
        line: 0,
        text: `identity.stability = "stable"`,
        reason: `the label cannot be "stable" while ${notGreen.length} launch gate(s) are not green with evidence: ${notGreen.map((g) => g.id).join(", ")} (${LAUNCH_GATES_PATH}; decision D2)`,
      });
    }
    return out;
  }
  for (const abs of labelSurfaces(root)) {
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of STABLE_WORDING) {
        if (re.test(line) && !WORDING_DISCLAIMER.test(line)) {
          out.push({
            gate: "status-label",
            file: relative(root, abs).replace(/\\/g, "/"),
            line: i + 1,
            text: line.trim().slice(0, 160),
            reason: `stable-production wording while the release label is "${stability}" (decision D2: "Public beta" until ${LAUNCH_GATES_PATH} is all green)`,
          });
        }
      }
    });
  }
  return out;
}

// ── Gate 9: README install table ────────────────────────────────────────────

export interface InstallRow {
  line: number;
  label: string;
  channel: ChannelId | "source" | null;
  status: "live" | "pending" | "unknown";
  text: string;
}

/** README row label → the channel whose live check backs it. */
export function channelOfRow(label: string): ChannelId | "source" | null {
  const l = label.replace(/[*`]/g, "").toLowerCase();
  if (l.startsWith("installer") || l.startsWith(".deb") || l.startsWith("github")) return "github-releases";
  if (l.startsWith("npm")) return "npm";
  if (l.startsWith("docker")) return "docker";
  if (l.startsWith("scoop")) return "scoop";
  if (l.startsWith("homebrew")) return "homebrew";
  if (l.startsWith("winget")) return "winget";
  if (l.startsWith("from source")) return "source";
  return null;
}

/** Rows of the table under "### 1. Install" (first table after the heading). */
export function parseInstallTable(readme: string): InstallRow[] {
  const lines = readme.split("\n");
  const start = lines.findIndex((l) => /^###\s+1\.\s+Install\b/.test(l));
  if (start < 0) return [];
  const rows: InstallRow[] = [];
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\|\s*Channel\s*\|/i.test(l)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (/^\|\s*-/.test(l)) continue;
    if (!l.startsWith("|")) break;
    const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    const label = cells[0] ?? "";
    const statusCell = cells[cells.length - 1] ?? "";
    const status = /✅/.test(statusCell) ? "live" : /⏳/.test(statusCell) ? "pending" : "unknown";
    rows.push({ line: i + 1, label, channel: channelOfRow(label), status, text: l.slice(0, 160) });
  }
  return rows;
}

export function lintChannelTable(manifest: ReleaseManifest, root: string): LaunchViolation[] {
  const file = "README.md";
  const rows = parseInstallTable(readFileSync(join(root, file), "utf8"));
  if (rows.length === 0) {
    return [{ gate: "channel-claim", file, line: 0, text: "", reason: `no install table found under "### 1. Install" (fail closed)` }];
  }
  const claimed = new Set<string>(manifest.channels?.claimed ?? []);
  const out: LaunchViolation[] = [];
  for (const r of rows) {
    if (r.channel === null) {
      out.push({ gate: "channel-claim", file, line: r.line, text: r.text, reason: `install row "${r.label}" does not map to a known channel (scripts/launch-claims.ts channelOfRow)` });
      continue;
    }
    if (r.status === "unknown") {
      out.push({ gate: "channel-claim", file, line: r.line, text: r.text, reason: `install row "${r.label}" has no status legend (✅ live or ⏳ pending)` });
      continue;
    }
    if (r.channel !== "source" && r.status === "live" && !claimed.has(r.channel)) {
      out.push({ gate: "channel-claim", file, line: r.line, text: r.text, reason: `"${r.label}" is marked live but channel "${r.channel}" is not in release.manifest.json channels.claimed` });
    }
  }
  return out;
}

export interface LiveChannelResult {
  channel: ChannelId;
  ok: boolean;
  detail: string;
}

/** Compare README live/pending legends with real `channel:live` results. */
export function compareTableWithLive(rows: InstallRow[], results: LiveChannelResult[]): { violations: LaunchViolation[]; stalePending: string[] } {
  const byChannel = new Map(results.map((r) => [r.channel, r]));
  const violations: LaunchViolation[] = [];
  const stalePending: string[] = [];
  for (const r of rows) {
    if (r.channel === null || r.channel === "source") continue;
    const live = byChannel.get(r.channel);
    if (!live) continue;
    if (r.status === "live" && !live.ok) {
      violations.push({
        gate: "channel-claim",
        file: "README.md",
        line: r.line,
        text: r.text,
        reason: `README says "${r.label}" is live, but channel:live reports ${r.channel} FAILING: ${live.detail}`,
      });
    }
    if (r.status === "pending" && live.ok) stalePending.push(`${r.label} (${r.channel}) now passes channel:live — update the README legend to ✅ live`);
  }
  return { violations, stalePending };
}

// ── Gate 10: VS Code extension listing (XR-LAUNCH-034) ──────────────────────

/**
 * Flip to true only after publish-vscode.yml has published `rrrtx.xr-vscode`
 * and the Marketplace/Open VSX listing resolves; then replace the README
 * preview label with the listing in the same PR.
 */
export const VSCODE_LISTED = false;

const LISTING_CLAIMS: RegExp[] = [
  /marketplace\.visualstudio\.com\/items\?itemName=rrrtx\./i,
  /open-vsx\.org\/extension\/rrrtx\//i,
  /(?:\bext install|--install-extension)\s+rrrtx\./i,
  /\b(install|get|download|available)\b[^.]{0,40}\b(from|on|in)\s+the\s+(VS Code\s+|Visual Studio\s+)?(Marketplace|Open VSX)\b/i,
];
/** One README line that names the extension, says preview, and points to the .vsix on Releases. */
export const VSCODE_PREVIEW_LABEL = /VS Code extension[^\n]*\bpreview\b[^\n]*\.vsix[^\n]*\bReleases\b/i;

export function lintVscodeListing(root: string, listed: boolean = VSCODE_LISTED): LaunchViolation[] {
  if (listed) return [];
  const out: LaunchViolation[] = [];
  const readme = join(root, "README.md");
  const text = existsSync(readme) ? readFileSync(readme, "utf8") : "";
  if (!VSCODE_PREVIEW_LABEL.test(text)) {
    out.push({
      gate: "vscode-listing",
      file: "README.md",
      line: 0,
      text: "",
      reason: 'the VS Code extension is not listed yet: README.md must label it "preview — install the .vsix from Releases" (XR-LAUNCH-034)',
    });
  }
  const surfaces = [...labelSurfaces(root), join(root, "extensions", "vscode", "README.md")].filter((p) => existsSync(p));
  for (const abs of surfaces) {
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
      if (WORDING_DISCLAIMER.test(line)) return;
      if (LISTING_CLAIMS.some((re) => re.test(line))) {
        out.push({
          gate: "vscode-listing",
          file: relative(root, abs).replace(/\\/g, "/"),
          line: i + 1,
          text: line.trim().slice(0, 160),
          reason: "claims a Marketplace/Open VSX listing that does not exist yet; point to the .vsix on GitHub Releases until publish-vscode.yml has run (XR-LAUNCH-034)",
        });
      }
    });
  }
  return out;
}
