/**
 * XR-LAUNCH-010 — claim-lint gates 8 (status label) and 9 (channel claims).
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  channelOfRow,
  compareTableWithLive,
  LAUNCH_GATES_PATH,
  lintChannelTable,
  lintStatusLabel,
  parseInstallTable,
} from "../../scripts/launch-claims.ts";
import { loadManifest, stampSiteTs, type ReleaseManifest } from "../../scripts/release-manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");
const manifest = loadManifest();

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "xr-claims-"));
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  return dir;
}

const gates = (status: string, evidence = "run 1") =>
  JSON.stringify({ gates: [{ id: "XR-LAUNCH-001", title: "t", status, evidence }] });
const withStability = (s: "stable" | "public-beta"): ReleaseManifest => ({ ...manifest, identity: { ...manifest.identity, stability: s } });

const TABLE = `## Quick start

### 1. Install

| Channel | Platform | Command | Status |
|---|---|---|---|
| **Installer** (verified binary) | Linux | \`curl … \\| bash\` | ✅ live |
| **npm** (\`latest\`) | any | \`npm i -g @rrrtx/xr\` | ✅ live |
| **Homebrew** | macOS | \`brew install ahmadrrrtx/tap/xr\` | ⏳ tap publish pending |
| **From source** | any | \`git clone\` | ✅ |
`;

describe("gate 8 — status label (decision D2)", () => {
  test("repository surfaces derive the actual authoritative maturity, not a hardcoded beta/stable label", () => {
    const label={"public-beta":"Public beta","developer-preview":"Developer preview","stable":"Stable"}[manifest.identity.stability ?? "public-beta"];
    expect(lintStatusLabel(manifest, ROOT)).toEqual([]);
    expect(readFileSync(join(ROOT, "README.md"), "utf8")).toContain(`**Status: ${label}.**`);
    expect(readFileSync(join(ROOT, "website/src/lib/site.ts"), "utf8")).toContain(`status: "${label}",`);
  });

  test("stable-production wording on a public surface fails while the label is beta", () => {
    const dir = fixture({ [LAUNCH_GATES_PATH]: gates("open", ""), "README.md": "> **Status: Stable.** production-ready.\n", "website/src/app/page.tsx": "<p>generally available</p>\n" });
    try {
      const v = lintStatusLabel(withStability("public-beta"), dir);
      expect(v.map((x) => x.file).sort()).toEqual(["README.md", "README.md", "website/src/app/page.tsx"]);
      expect(v.every((x) => x.gate === "status-label")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a disclaimer is allowed", () => {
    const dir = fixture({ [LAUNCH_GATES_PATH]: gates("open", ""), "README.md": "XR is not production-ready until the gates are green.\n" });
    try {
      expect(lintStatusLabel(withStability("public-beta"), dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the label cannot become stable while a gate is open, or green without evidence", () => {
    for (const [status, evidence, expected] of [["open", "", 1], ["green", "", 1], ["green", "https://ci/run/1", 0]] as const) {
      const dir = fixture({ [LAUNCH_GATES_PATH]: gates(status, evidence), "README.md": "x\n" });
      try {
        expect(lintStatusLabel(withStability("stable"), dir)).toHaveLength(expected);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("a missing gate file fails closed", () => {
    const dir = fixture({ "README.md": "x\n" });
    try {
      expect(lintStatusLabel(withStability("public-beta"), dir)[0]?.reason).toContain("fail closed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the site stamp writes the label", () => {
    const out = stampSiteTs(readFileSync(join(ROOT, "website/src/lib/site.ts"), "utf8"), { ...manifest.identity, stability: "developer-preview" }, 65, "1.0.0");
    expect(out).toContain('status: "Developer preview",');
  });
});

describe("gate 9 — README channel claims", () => {
  test("rows parse with channel and legend", () => {
    const rows = parseInstallTable(TABLE);
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ["github-releases", "live"],
      ["npm", "live"],
      ["homebrew", "pending"],
      ["source", "live"],
    ]);
    expect(channelOfRow("**.deb**")).toBe("github-releases");
    expect(channelOfRow("**Snap**")).toBeNull();
  });

  test("the repository README maps every row and passes the static gate", () => {
    expect(parseInstallTable(readFileSync(join(ROOT, "README.md"), "utf8")).length).toBeGreaterThanOrEqual(8);
    expect(lintChannelTable(manifest, ROOT)).toEqual([]);
  });

  test("a live row for an unclaimed channel, an unknown channel or a missing legend fails", () => {
    const bad = TABLE.replace("| ⏳ tap publish pending |", "| ✅ live |") + "| **Snap** | linux | `snap install xr` | ✅ live |\n";
    const dir = fixture({ "README.md": bad.replace("| **npm** (`latest`) | any | `npm i -g @rrrtx/xr` | ✅ live |", "| **npm** (`latest`) | any | `npm i -g @rrrtx/xr` | soon |") });
    try {
      const m: ReleaseManifest = { ...manifest, channels: { ...manifest.channels!, claimed: ["github-releases", "npm"] } };
      const reasons = lintChannelTable(m, dir).map((v) => v.reason);
      expect(reasons.some((r) => r.includes("no status legend"))).toBe(true);
      expect(reasons.some((r) => r.includes("not in release.manifest.json channels.claimed"))).toBe(true);
      expect(reasons.some((r) => r.includes("does not map to a known channel"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--live: a row marked live for a failing channel is a violation; a passing pending row is a note", () => {
    const rows = parseInstallTable(TABLE);
    const { violations, stalePending } = compareTableWithLive(rows, [
      { channel: "github-releases", ok: false, detail: 'GitHub "Latest" release is v1.1.0' },
      { channel: "npm", ok: true, detail: "latest = 1.0.0" },
      { channel: "homebrew", ok: true, detail: "ok" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.reason).toContain("github-releases FAILING");
    expect(stalePending).toHaveLength(1);
  });
});
