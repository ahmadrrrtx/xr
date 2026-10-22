/**
 * XR-LAUNCH-012 / 022 — the CI policy, the flaky-test quarantine and the
 * generated support matrix are themselves tested: the repo's real workflows
 * must pass, and each rule must catch the violation it exists for.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkPins, checkRuntime, checkWorkflows, loadWorkflows } from "../../scripts/ci-policy.ts";
import { checkQuarantine, loadQuarantine, type QuarantineEntry } from "../../scripts/quarantine.ts";
import { BEGIN, END, cellFor, render, splice, type Targets } from "../../scripts/support-matrix.ts";
import type { JourneyEvidence } from "../../scripts/journey/cli-journey.ts";

const ROOT = join(import.meta.dir, "..", "..");
const rc = JSON.parse(readFileSync(join(ROOT, ".github/required-checks.json"), "utf8"));

describe("ci-policy", () => {
  test("the repository's workflows satisfy the policy", () => {
    expect(checkWorkflows(loadWorkflows(), rc)).toEqual([]);
  });

  test("required set is the D7 set", () => {
    expect(rc.required.map((r: { workflow: string }) => r.workflow).sort()).toEqual(
      ["ci.yml", "cross-platform.yml", "desktop-app.yml", "journey.yml", "npm-pack-smoke.yml", "supply-chain.yml"],
    );
    expect(rc.nonGating.map((r: { workflow: string }) => r.workflow).sort()).toEqual(
      ["os-sandbox.yml", "provider-canaries.yml", "real-device-matrix.yml", "soak.yml", "windows-arm64.yml", "workflow-audit.yml"],
    );
  });

  test("pins: tag refs, short SHAs and missing tag comments are violations", () => {
    const sha = "a".repeat(40);
    expect(checkPins("w.yml", `      - uses: actions/checkout@v4`)).toHaveLength(1);
    expect(checkPins("w.yml", `      - uses: actions/checkout@abc1234 # v4`)).toHaveLength(1);
    expect(checkPins("w.yml", `      - uses: actions/checkout@${sha}`)).toHaveLength(1);
    expect(checkPins("w.yml", `      - uses: actions/checkout@${sha} # v4`)).toEqual([]);
    expect(checkPins("w.yml", `    uses: ./.github/workflows/journey.yml`)).toEqual([]);
    expect(checkPins("w.yml", `    uses: slsa-framework/slsa-github-generator/.github/workflows/generator_generic_slsa3.yml@v2.0.0`)).toEqual([]);
  });

  test("runtime (032): floating ubuntu image and Node 20-era first-party majors are violations", () => {
    const sha = "a".repeat(40);
    expect(checkRuntime("w.yml", "    runs-on: ubuntu-latest")).toHaveLength(1);
    expect(checkRuntime("w.yml", "        os: [ubuntu-latest, macos-latest]")).toHaveLength(1);
    expect(checkRuntime("w.yml", "    runs-on: ubuntu-24.04 # was ubuntu-latest")).toEqual([]);
    expect(checkRuntime("w.yml", "# ubuntu-latest moves to 26.04")).toEqual([]);
    expect(checkRuntime("w.yml", `      - uses: actions/checkout@${sha} # v4`)).toHaveLength(1);
    expect(checkRuntime("w.yml", `      - uses: actions/checkout@${sha} # v5.1.0`)).toEqual([]);
    expect(checkRuntime("w.yml", `      - uses: actions/cache/restore@${sha} # v4.2.0`)).toHaveLength(1);
    // v5 of upload-artifact still defaulted to node20; v6 is the first node24 major
    expect(checkRuntime("w.yml", `      - uses: actions/upload-artifact@${sha} # v5.0.0`)).toHaveLength(1);
    expect(checkRuntime("w.yml", `      - uses: actions/download-artifact@${sha} # v7.0.0`)).toEqual([]);
    expect(checkRuntime("w.yml", `      - uses: actions/github-script@${sha}`)).toHaveLength(1);
    expect(checkRuntime("w.yml", `      - uses: oven-sh/setup-bun@${sha} # v2`)).toEqual([]);
  });

  test("runtime (032): the pre-032 workflows would have failed rule 7", () => {
    const old = Bun.spawnSync(["git", "show", "a9a9dd5f:.github/workflows/ci.yml"], { cwd: ROOT });
    if (old.exitCode !== 0) return; // shallow clone without history: nothing to compare
    const v = checkRuntime("ci.yml", old.stdout.toString());
    expect(v.some((x) => x.includes("ubuntu-latest"))).toBe(true);
    expect(v.some((x) => x.includes("actions/checkout must be v5+"))).toBe(true);
  });

  const wf = (yaml: string) => ({ "x.yml": { parsed: Bun.YAML.parse(yaml) as never, text: yaml } });
  const req = { required: [{ workflow: "x.yml", job: "gate", context: "X gate" }], advisoryJobs: [], nonGatingLegs: [], nonGating: [] };
  const good = `name: X
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  a:
    runs-on: ubuntu-24.04
    steps: [{ run: "true" }]
  gate:
    name: X gate
    if: always()
    needs: [a]
    runs-on: ubuntu-24.04
    steps: [{ run: "true" }]
`;

  test("a correct gate passes; each defect is caught", () => {
    expect(checkWorkflows(wf(good), req)).toEqual([]);
    expect(checkWorkflows(wf(good.replace("  pull_request:\n    branches: [main]", "  pull_request:\n    paths: [src/**]")), req).join()).toContain("paths filter");
    expect(checkWorkflows(wf(good.replace("    if: always()\n", "")), req).join()).toContain("always()");
    expect(checkWorkflows(wf(good.replace("needs: [a]", "needs: []")), req).join()).toContain("does not need job a");
    expect(checkWorkflows(wf(good.replace("name: X gate", "name: Something else")), req).join()).toContain("branch protection expects");
    expect(checkWorkflows(wf(good.replace("  a:\n    runs-on: ubuntu-24.04", "  a:\n    continue-on-error: true\n    runs-on: ubuntu-24.04")), req).join()).toContain("continue-on-error");
    expect(checkWorkflows(wf(good.replace('steps: [{ run: "true" }]', 'steps: [{ name: s, run: "true", continue-on-error: true }]')), req).join()).toContain("failure()-only");
    expect(checkWorkflows(wf(good.replace('steps: [{ run: "true" }]', 'steps: [{ uses: oven-sh/setup-bun@x, with: { bun-version: "1.4.2" } }]')), req).join()).toContain("bun-version-file");
  });

  test("non-gating workflows must say so", () => {
    const r = { ...req, required: [], nonGating: [{ workflow: "x.yml" }] };
    expect(checkWorkflows(wf(good), r).join()).toContain("(non-gating)");
    expect(checkWorkflows(wf(good.replace("name: X\n", "name: X (non-gating)\n")), r)).toEqual([]);
  });
});

describe("quarantine", () => {
  const ok: QuarantineEntry = { file: "test/daemon/phase2b.test.ts", owner: "@ahmadrrrtx", issue: "XR-LAUNCH-012", added: "2026-10-22", expires: "2026-12-01", reason: "approval round-trip timed out under load" };

  test("the committed quarantine is valid today", () => {
    expect(checkQuarantine(loadQuarantine(), new Date().toISOString().slice(0, 10))).toEqual([]);
  });

  test("expiry, missing owner/issue, long spans and missing files are violations", () => {
    expect(checkQuarantine([ok], "2026-11-01")).toEqual([]);
    expect(checkQuarantine([ok], "2026-12-02").join()).toContain("EXPIRED");
    expect(checkQuarantine([{ ...ok, owner: "" }], "2026-11-01").join()).toContain("owner");
    expect(checkQuarantine([{ ...ok, issue: "later" }], "2026-11-01").join()).toContain("issue");
    expect(checkQuarantine([{ ...ok, expires: "2027-06-01" }], "2026-11-01").join()).toContain("max 45");
    expect(checkQuarantine([{ ...ok, file: "test/nope.test.ts" }], "2026-11-01").join()).toContain("does not exist");
  });
});

describe("support matrix is generated from evidence", () => {
  const targets: Targets = {
    steps: ["build", "package", "install", "launch", "agent", "update", "uninstall"],
    targets: [
      { id: "cli-npm-linux-x64", surface: "npm CLI", label: "Linux x64" },
      { id: "desktop-darwin-x64", surface: "Desktop", label: "macOS x64", descopes: { update: "needs XR-LAUNCH-008 keys" } },
      { id: "cli-npm-windows-arm64", surface: "npm CLI", label: "Windows ARM64", gating: false },
    ],
  };
  const ev = (target: string, cls: "CI" | "LR", status: "pass" | "fail", at = "2026-10-22T00:00:00Z"): JourneyEvidence => ({
    schema: 1, kind: "cli-journey", channel: "npm", target, os: "linux", arch: "x64", version: "1.1.0", nextVersion: "1.1.1-journey.1",
    evidenceClass: cls, commit: "0123456789abcdef", runUrl: null, runner: "local", at, result: status,
    steps: targets.steps.map((step) => ({ step, status, detail: status === "fail" ? `boom in ${step}` : "ok", ms: 1 })),
  });

  test("a passing record makes ✅ with its evidence class; a de-scope wins; nothing is ⏳", () => {
    const t = targets.targets;
    expect(cellFor(t[0]!, "install", [ev("cli-npm-linux-x64", "LR", "pass")])).toMatchObject({ kind: "pass", classes: ["LR"] });
    expect(cellFor(t[0]!, "install", [ev("cli-npm-linux-x64", "LR", "pass"), ev("cli-npm-linux-x64", "CI", "pass")])).toMatchObject({ classes: ["CI", "LR"] });
    expect(cellFor(t[1]!, "update", [])).toMatchObject({ kind: "descoped" });
    expect(cellFor(t[0]!, "agent", [ev("cli-npm-linux-x64", "CI", "fail")])).toMatchObject({ kind: "fail" });
    expect(cellFor(t[0]!, "agent", [ev("other", "CI", "pass")])).toEqual({ kind: "none" });
  });

  test("the launch gate counts only gating cells without ✅/➖", () => {
    const { incomplete, markdown } = render(targets, [ev("cli-npm-linux-x64", "CI", "pass")]);
    expect(incomplete).toEqual(["build", "package", "install", "launch", "agent", "uninstall"].map((s) => `desktop-darwin-x64:${s}`));
    expect(markdown.startsWith(BEGIN) && markdown.endsWith(END)).toBe(true);
    expect(markdown).toContain("| npm CLI | Linux x64 | ✅ CI |");
    expect(markdown).toContain("Windows ARM64 ¹");
  });

  test("splice replaces only the generated block", () => {
    const doc = `# T\n\nintro\n\n${BEGIN}\nold\n${END}\n\n## Rest\n`;
    expect(splice(doc, `${BEGIN}\nnew\n${END}`)).toBe(`# T\n\nintro\n\n${BEGIN}\nnew\n${END}\n\n## Rest\n`);
  });

  test("the committed SUPPORT_MATRIX.md block is current", () => {
    const r = Bun.spawnSync(["bun", "run", "scripts/support-matrix.ts", "--check"], { cwd: ROOT });
    expect(r.stderr.toString()).toBe("");
    expect(r.exitCode).toBe(0);
  });
});
