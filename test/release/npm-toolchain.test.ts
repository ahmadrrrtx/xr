/*
 * NEW-21: a workflow must never upgrade npm in place.
 *
 * The v1.2.0-preview.5 promotion (run 45482534667) failed in "Ensure npm supports trusted publishing" two seconds
 * after it began. Node 22.22.2 bundles npm 10.9.7, and that npm's `npm install -g npm@12.2.1` swaps out its own
 * modules while it is still running, then dies with `MODULE_NOT_FOUND: Cannot find module 'promise-retry'`
 * (reproduced from a clean npm 10.9.7). npm 10.9.8 happens to survive the same upgrade, so the bug depends on the
 * runner's Node patch level, and a pin that "works on my machine" can still break the owner-only publish job,
 * which no pull request ever runs. The fix installs npm into a separate prefix and puts that first on PATH, so the
 * running npm is never overwritten.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const WORKFLOWS = resolve(import.meta.dir, "../../.github/workflows");

type Step = { name?: string; run?: string };
type Job = { steps?: Step[] };
type Workflow = { jobs?: Record<string, Job> };

const workflows = readdirSync(WORKFLOWS)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((file) => ({ file, doc: Bun.YAML.parse(readFileSync(join(WORKFLOWS, file), "utf8")) as Workflow }));

/** Every `run:` line that installs the npm CLI itself, with its workflow, job and step. */
function npmSelfInstalls() {
  const found: Array<{ where: string; line: string; run: string }> = [];
  for (const { file, doc } of workflows)
    for (const [job, spec] of Object.entries(doc.jobs ?? {}))
      for (const step of spec.steps ?? []) {
        const run = step.run ?? "";
        for (const line of run.split("\n"))
          if (/\bnpm\s+(?:install|i|add)\b.*\s(?:-g|--global)\b.*\snpm@|\bnpm\s+(?:install|i|add)\b.*\snpm@.*\s(?:-g|--global)\b/.test(line))
            found.push({ where: `${file} › ${job} › ${step.name ?? "(unnamed step)"}`, line: line.trim(), run });
      }
  return found;
}

describe("NEW-21 · npm is never upgraded in place", () => {
  test("the publish workflows still install a pinned npm (the check below is not vacuous)", () => {
    const where = npmSelfInstalls().map((i) => i.where);
    expect(where.some((w) => w.startsWith("release.yml › publish-npm"))).toBe(true);
    expect(where.some((w) => w.startsWith("publish-channels.yml"))).toBe(true);
  });

  test("every global npm install targets a separate prefix and puts it on PATH", () => {
    for (const install of npmSelfInstalls()) {
      expect({ where: install.where, line: install.line, separatePrefix: /--prefix\s+"?\$RUNNER_TEMP\//.test(install.line) }).toEqual({
        where: install.where,
        line: install.line,
        separatePrefix: true,
      });
      expect({ where: install.where, onPath: /"\$RUNNER_TEMP\/npm\/bin"\s*>>\s*"\$GITHUB_PATH"/.test(install.run) }).toEqual({
        where: install.where,
        onPath: true,
      });
    }
  });

  test("the npm publish step refuses to run unless the pinned npm is the one on PATH", () => {
    const release = workflows.find((w) => w.file === "release.yml")!.doc;
    const publish = (release.jobs?.["publish-npm"]?.steps ?? []).find((s) => (s.run ?? "").includes("npm publish"));
    expect(publish?.run ?? "").toContain('[ "$(npm --version)" = "12.2.1" ]');
  });
});
