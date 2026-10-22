/**
 * XR-LAUNCH-034 — VS Code extension: owner-run publishing, preview label, and
 * durable pairing that stays in lockstep with the daemon's token file.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const parseYaml = (text: string): unknown => Bun.YAML.parse(text);
import { lintVscodeListing, VSCODE_LISTED, VSCODE_PREVIEW_LABEL } from "../../scripts/launch-claims.ts";
import { daemonTokenPath as daemonSidePath, readDaemonTokenFile as daemonSideRead, writeDaemonTokenFile } from "../../src/daemon/token-file.ts";
import { daemonTokenPath as extensionSidePath, readDaemonTokenFile as extensionSideRead } from "../../extensions/vscode/src/daemon/token-file.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Job = { name?: string; if?: string; needs?: string | string[]; permissions?: Record<string, string>; steps?: Step[] };
type Workflow = { name?: string; on: Record<string, unknown>; permissions?: Record<string, string>; jobs: Record<string, Job> };

describe("publish-vscode.yml is owner-run and secret-gated", () => {
  const text = read(".github/workflows/publish-vscode.yml");
  const wf = parseYaml(text) as Workflow;

  test("workflow_dispatch only, read-only by default; only the release job can write", () => {
    expect(Object.keys(wf.on)).toEqual(["workflow_dispatch"]);
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const [id, job] of Object.entries(wf.jobs)) {
      if (id === "release") expect(job.permissions).toEqual({ contents: "write" });
      else expect(job.permissions).toBeUndefined();
    }
  });

  test("publishing targets default off and each runs only when ticked", () => {
    const inputs = (wf.on.workflow_dispatch as { inputs: Record<string, { default?: unknown }> }).inputs;
    expect(inputs.marketplace?.default).toBe(false);
    expect(inputs.openvsx?.default).toBe(false);
    expect(wf.jobs.marketplace?.if).toContain("inputs.marketplace");
    expect(wf.jobs.openvsx?.if).toContain("inputs.openvsx");
    expect(wf.jobs.release?.if).toContain("inputs.release_tag != ''");
  });

  test("secrets reach steps only through env, never interpolated into a script or argv", () => {
    for (const job of Object.values(wf.jobs)) {
      for (const st of job.steps ?? []) {
        expect(st.run ?? "").not.toContain("secrets.");
        expect(JSON.stringify(st.with ?? {})).not.toContain("secrets.");
      }
    }
    expect(text).not.toMatch(/\b(vsce|ovsx)\b[^\n]*\s(-p|--pat)\s/); // no PAT flag on a publish command line
    const ovsx = wf.jobs.openvsx!.steps!.find((s) => s.run?.includes("open-vsx.org"))!;
    expect(ovsx.run).toContain("curl --config -");
    expect(ovsx.env?.OVSX_PAT).toBe("${{ secrets.OVSX_PAT }}");
    const vsce = wf.jobs.marketplace!.steps!.find((s) => s.run?.includes("vsce publish"))!;
    expect(vsce.env?.VSCE_PAT).toBe("${{ secrets.VSCE_PAT }}");
  });

  test("a ticked target without its secret fails loudly before anything is published", () => {
    for (const [job, secret] of [["marketplace", "VSCE_PAT"], ["openvsx", "OVSX_PAT"]] as const) {
      const first = wf.jobs[job]!.steps![0]!;
      expect(first.name).toBe("Require the secret");
      expect(first.run).toContain(`if [ -z "\${${secret}}" ]`);
      expect(first.run).toContain("exit 1");
    }
  });

  test("the package is built from the lockfile, tested, and checksum-verified before every upload", () => {
    const build = wf.jobs.build!.steps!.map((s) => s.run ?? "").join("\n");
    expect(build).toContain("npm ci --ignore-scripts");
    expect(build).toContain("npm run typecheck");
    expect(build).toContain("npm test");
    expect(build).toContain("sha256sum");
    for (const job of ["release", "marketplace", "openvsx"]) {
      expect(wf.jobs[job]!.steps!.map((s) => s.run ?? "").join("\n")).toContain("sha256sum -c");
    }
    expect(text).not.toContain("--clobber"); // never overwrite an existing release asset
  });
});

describe("CI runs the extension's own checks inside the Quality Gate", () => {
  test("ci.yml has a vscode-extension job and the gate needs it", () => {
    const ci = parseYaml(read(".github/workflows/ci.yml")) as Workflow;
    const job = ci.jobs["vscode-extension"]!;
    const runs = job.steps!.map((s) => s.run ?? "").join("\n");
    expect(runs).toContain("npm ci --ignore-scripts");
    expect(runs).toContain("npm run typecheck");
    expect(runs).toContain("npm test");
    expect(runs).toContain("vsce package");
    expect(runs).not.toContain("publish");
    expect(ci.jobs["quality-gate"]!.needs).toContain("vscode-extension");
  });
});

describe("claim-lint gate 10 — preview label until listed", () => {
  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "xr-vscode-claims-"));
    for (const [p, c] of Object.entries(files)) {
      mkdirSync(join(dir, p, ".."), { recursive: true });
      writeFileSync(join(dir, p), c);
    }
    return dir;
  }
  const LABEL = "**VS Code extension** (preview — install the `.vsix` from [GitHub Releases](https://github.com/x/releases)).\n";

  test("the repository passes and is still unlisted", () => {
    expect(VSCODE_LISTED).toBe(false);
    expect(VSCODE_PREVIEW_LABEL.test(read("README.md"))).toBe(true);
    expect(lintVscodeListing(ROOT)).toEqual([]);
  });

  test("a README without the preview label fails", () => {
    const dir = fixture({ "README.md": "**VS Code extension**: the agent in your editor.\n" });
    try {
      const v = lintVscodeListing(dir);
      expect(v).toHaveLength(1);
      expect(v[0]!.gate).toBe("vscode-listing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("listing claims fail on any surface; honest 'not yet listed' lines pass; listed=true disables the gate", () => {
    const dir = fixture({
      "README.md": LABEL + "Install it from the VS Code Marketplace.\nIt is not yet listed on the Marketplace.\n",
      "extensions/vscode/README.md": "Run `code --install-extension rrrtx.xr-vscode`.\nSee https://marketplace.visualstudio.com/items?itemName=rrrtx.xr-vscode\n",
      "website/src/app/page.tsx": "<a href='https://open-vsx.org/extension/rrrtx/xr-vscode'>Open VSX</a>\n",
    });
    try {
      const v = lintVscodeListing(dir);
      expect(v.map((x) => `${x.file}:${x.line}`).sort()).toEqual(
        ["README.md:2", "extensions/vscode/README.md:1", "extensions/vscode/README.md:2", "website/src/app/page.tsx:1"].sort(),
      );
      expect(lintVscodeListing(dir, true)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("durable pairing: the extension reads exactly what the daemon writes", () => {
  test("same path rule for XR_HOME and the ~/.xr default", () => {
    for (const env of [{ XR_HOME: "/srv/xr-home" }, {}] as NodeJS.ProcessEnv[]) {
      expect(extensionSidePath(env)).toBe(daemonSidePath(env));
    }
  });

  test("a token written by the daemon module passes the extension's owner/permission guards", () => {
    const home = mkdtempSync(join(tmpdir(), "xr-034-pair-"));
    const env = { XR_HOME: home } as NodeJS.ProcessEnv;
    const token = "pair_0123456789abcdef0123456789abcdef";
    const written = writeDaemonTokenFile(token, env);
    try {
      expect(written.path).toBe(extensionSidePath(env));
      const r = extensionSideRead({ env });
      expect(r.ok && r.token).toBe(token);
      expect(daemonSideRead(env)).toBe(token);
      written.release();
      expect(extensionSideRead({ env }).ok).toBe(false);
    } finally {
      written.release();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
