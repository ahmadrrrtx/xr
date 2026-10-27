/** Existing Publish Channels workflow's WinGet PR transport. No unverified
 * downloaded executable, token argv/remote URL, global git config, repository
 * clone or force push. Dry-run by default; --submit requires owner GH_TOKEN. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSums } from "./verify-release";
export interface WingetChange {
  path: string;
  content: string;
}
export function checkedWingetChanges(
  root: string,
  id: string,
  version: string,
  sums: Map<string, string>,
): WingetChange[] {
  if (
    !/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/.test(id) ||
    !/^\d+\.\d+\.\d+$/.test(version)
  )
    throw new Error("Stable version and canonical package ID required");
  const dir = `manifests/${id[0]!.toLowerCase()}/${id.split(".").join("/")}/${version}`;
  return [`${id}.yaml`, `${id}.installer.yaml`, `${id}.locale.en-US.yaml`].map(
    (name) => {
      const bytes = readFileSync(join(root, dir, name));
      if (sums.get(name) !== createHash("sha256").update(bytes).digest("hex"))
        throw new Error(
          "WinGet bytes differ from the verified release inventory; no API mutation allowed",
        );
      return { path: `${dir}/${name}`, content: bytes.toString("base64") };
    },
  );
}
type Api = (
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<any>;
const upstream = "microsoft/winget-pkgs";
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value))
    throw new Error("GitHub returned no valid object SHA");
  return value;
}
export async function submitWinget(
  api: Api,
  changes: WingetChange[],
  id: string,
  version: string,
): Promise<string> {
  if (
    !/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/.test(id) ||
    !/^\d+\.\d+\.\d+$/.test(version)
  )
    throw new Error("Stable canonical identity required");
  const prefix = `manifests/${id[0]!.toLowerCase()}/${id.split(".").join("/")}/${version}/`;
  const expected = new Set([
    `${prefix}${id}.yaml`,
    `${prefix}${id}.installer.yaml`,
    `${prefix}${id}.locale.en-US.yaml`,
  ]);
  if (
    changes.length !== 3 ||
    new Set(changes.map((c) => c.path)).size !== 3 ||
    changes.some((c) => !expected.has(c.path) || c.content.length > 1_400_000)
  )
    throw new Error(
      "Only the three bounded verified WinGet files may be submitted",
    );
  const user = await api("GET", "/user"),
    owner = user?.login;
  if (typeof owner !== "string" || !/^[A-Za-z0-9-]+$/.test(owner))
    throw new Error("Authenticated owner unavailable");
  const info = await api("GET", `/repos/${upstream}`),
    base = info?.default_branch;
  if (typeof base !== "string")
    throw new Error("Upstream default branch unavailable");
  const ref = await api(
      "GET",
      `/repos/${upstream}/git/ref/heads/${encodeURIComponent(base)}`,
    ),
    parent = sha(ref?.object?.sha);
  const commit = await api("GET", `/repos/${upstream}/git/commits/${parent}`),
    baseTree = sha(commit?.tree?.sha);
  let fork = await api("GET", `/repos/${owner}/winget-pkgs`);
  if (!fork) {
    await api("POST", `/repos/${upstream}/forks`, {
      default_branch_only: true,
    });
    for (let i = 0; i < 30 && !fork; i++) {
      await Bun.sleep(1000);
      fork = await api("GET", `/repos/${owner}/winget-pkgs`);
    }
  }
  if (
    !fork?.fork ||
    (fork.source?.full_name ?? fork.parent?.full_name) !== upstream
  )
    throw new Error(
      "Owner fork is unavailable or not a WinGet fork; no unrelated repository touched",
    );
  const repo = `/repos/${owner}/winget-pkgs`,
    branch = `xr-${id}-${version}`;
  if (await api("GET", `${repo}/git/ref/heads/${encodeURIComponent(branch)}`))
    throw new Error(
      "Staging branch already exists; review it explicitly, never force-replace owner work",
    );
  const tree = [];
  for (const file of changes) {
    const blob = await api("POST", `${repo}/git/blobs`, {
      content: file.content,
      encoding: "base64",
    });
    tree.push({
      path: file.path,
      mode: "100644",
      type: "blob",
      sha: sha(blob?.sha),
    });
  }
  const next = await api("POST", `${repo}/git/trees`, {
    base_tree: baseTree,
    tree,
  });
  const nextCommit = await api("POST", `${repo}/git/commits`, {
    message: `${id} ${version} from verified XR release inventory`,
    tree: sha(next?.sha),
    parents: [parent],
  });
  await api("POST", `${repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: sha(nextCommit?.sha),
  });
  const pr = await api("POST", `/repos/${upstream}/pulls`, {
    title: `New version: ${id} version ${version}`,
    head: `${owner}:${branch}`,
    base,
    body: "Generated from XR release metadata whose bytes and pinned installer hashes were verified by the owner-dispatched Publish Channels gate. Community review/installation is pending; this submission is not a live install PASS.",
  });
  if (
    typeof pr?.html_url !== "string" ||
    !pr.html_url.startsWith(`https://github.com/${upstream}/pull/`)
  )
    throw new Error(
      "Submission response unavailable; do not claim publication success",
    );
  return pr.html_url;
}
if (import.meta.main) {
  const args = process.argv.slice(2),
    get = (f: string) => {
      const i = args.indexOf(f);
      return i >= 0 ? args[i + 1] : undefined;
    };
  const id = get("--id"),
    version = get("--version"),
    root = get("--root"),
    sums = get("--sums");
  if (!id || !version || !root || !sums)
    throw new Error("--id --version --root --sums required");
  const changes = checkedWingetChanges(
    root,
    id,
    version,
    parseSums(readFileSync(sums, "utf8")),
  );
  if (!args.includes("--submit"))
    console.log(
      JSON.stringify(
        {
          mode: "DRY RUN; no remote changes",
          paths: changes.map((c) => c.path),
        },
        null,
        2,
      ),
    );
  else {
    const token = process.env.GH_TOKEN;
    if (!token)
      throw new Error("Owner GH_TOKEN required; never pass it as an argument");
    const api: Api = async (method, path, body) => {
      const r = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (method === "GET" && r.status === 404) return null;
      if (!r.ok)
        throw new Error(
          `WinGet GitHub operation failed HTTP${r.status}; no credential/response body logged`,
        );
      return r.json();
    };
    console.log(await submitWinget(api, changes, id, version));
  }
}
