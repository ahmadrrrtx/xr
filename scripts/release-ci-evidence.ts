/** Fail closed on same-commit, same-tag native CI evidence. No stored boolean
 * can substitute for an actually successful tagged Desktop gate. No mutation
 * of releases occurs here. Token is sent only to api.github.com, never argv. */
import { readFileSync } from "node:fs";
import { loadManifest, validateReleaseTag } from "./release-manifest";
type Api = (path: string) => Promise<any>;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export async function assertDraftOnly(api: Api, tag: string): Promise<void> {
  const release = await api(`/releases/tags/${encodeURIComponent(tag)}`);
  if (release !== null && release.draft !== true)
    throw new Error(
      "Existing published release is immutable to this preparation workflow; refuse asset replacement/downgrade",
    );
}
export async function requireNativeEvidence(
  api: Api,
  sha: string,
  tag: string,
): Promise<{
  runId: number;
  runUrl: string;
  sha: string;
  tag: string;
  gate: string;
}> {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Exact commit SHA required");
  const data = await api(
    `/actions/workflows/desktop-app.yml/runs?head_sha=${sha}&per_page=100`,
  );
  if (!Array.isArray(data?.workflow_runs))
    throw new Error("Missing/unavailable native CI response");
  const matching = data.workflow_runs
    .filter(
      (r: any) =>
        r.head_sha === sha &&
        r.head_branch === tag &&
        ["push", "workflow_dispatch"].includes(r.event) &&
        r.path?.split("@")[0] === ".github/workflows/desktop-app.yml",
    )
    .sort(
      (a: any, b: any) =>
        (b.run_number ?? 0) - (a.run_number ?? 0) ||
        (b.run_attempt ?? 0) - (a.run_attempt ?? 0),
    );
  const run = matching[0];
  if (
    !run ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !Number.isSafeInteger(run.id)
  )
    throw new Error(
      "No successful current same-tag/same-SHA Desktop workflow (PR/main/older success is not release evidence)",
    );
  const jobs = await api(`/actions/runs/${run.id}/jobs?per_page=100`),
    name = "Desktop gate (bundles + latest.json + journey)";
  const gate = jobs?.jobs?.filter((j: any) => j.name === name);
  if (
    !Array.isArray(gate) ||
    gate.length !== 1 ||
    gate[0].status !== "completed" ||
    gate[0].conclusion !== "success"
  )
    throw new Error("Native aggregate gate missing/skipped/failed");
  return { runId: run.id, runUrl: run.html_url, sha, tag, gate: name };
}
if (import.meta.main) {
  const args = process.argv.slice(2),
    get = (key: string) => {
      const i = args.indexOf(key);
      return i >= 0 ? args[i + 1] : undefined;
    };
  const repo = process.env.GITHUB_REPOSITORY ?? "ahmadrrrtx/xr",
    tag = get("--tag") ?? process.env.GITHUB_REF_NAME,
    sha = get("--sha") ?? process.env.GITHUB_SHA;
  if (!REPO.test(repo) || !tag) throw new Error("Repository + tag required");
  validateReleaseTag(loadManifest(), tag);
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!token)
    throw new Error(
      "Authenticated GitHub API token required to distinguish private drafts from absence",
    );
  const api: Api = async (path) => {
    const response = await fetch(
      `https://api.github.com/repos/${repo}${path}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: `Bearer ${token}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status === 404 && path.startsWith("/releases/tags/"))
      return null;
    if (!response.ok)
      throw new Error(
        `GitHub evidence unavailable (HTTP${response.status}); not a successful gate`,
      );
    return response.json();
  };
  if (args.includes("--draft-only")) {
    await assertDraftOnly(api, tag);
    console.log(
      "Draft preparation permitted; no published release will be overwritten",
    );
  } else {
    if (!sha) throw new Error("SHA required");
    const seconds = Number(get("--wait-seconds") ?? 0);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 7200)
      throw new Error("Invalid bounded CI wait");
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      try {
        const result = await requireNativeEvidence(api, sha, tag);
        console.log(JSON.stringify(result, null, 2));
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await Bun.sleep(Math.min(30_000, Math.max(1, deadline - Date.now())));
      }
    }
  }
}
