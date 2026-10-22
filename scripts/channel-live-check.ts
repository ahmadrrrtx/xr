#!/usr/bin/env bun
/**
 * Launch audit XR-LAUNCH-001 — live public-channel coherence check.
 *
 * Repo-side gates (release:check, channel:check, claim-lint) prove the repo is
 * internally consistent. They could not see that v1.1.0 had no CLI assets, that
 * npm still served 1.0.0, or that the Homebrew tap and WinGet package did not
 * exist. This check asks the live registries instead.
 *
 * For `channels.publicVersion` (or --version X when vetting a promotion) it
 * checks every channel in `channels.claimed`:
 *
 *   github-releases  release vX exists, is not draft/pre-release, is GitHub's
 *                    "latest", carries SHA256SUMS (+ cosign bundle), the
 *                    source archive and every installer-mapped binary, all
 *                    listed in SHA256SUMS. Withdrawn tags are pre-release.
 *   npm              dist-tag `latest` == X; no withdrawn version published;
 *                    every version above the latest major deprecated → @latest (XR-LAUNCH-023).
 *   homebrew         <tap>/Formula/xr.rb declares X; every url/sha256 pair
 *                    matches the release's SHA256SUMS.
 *   winget           microsoft/winget-pkgs carries X for the package id with the
 *                    signed zip's sha256.
 *   scoop            the release's xr.json declares X with the signed zip's sha256.
 *   docker           <image>:X exists and <image>:latest is the same digest.
 *
 * Usage:
 *   bun run channel:live                     # check channels.publicVersion
 *   bun run channel:live -- --version 1.2.0  # vet a candidate before promotion
 *   bun run channel:live -- --json
 *   bun run channel:live -- --channels npm,docker
 *
 * Exit 0 only when every checked channel passes. Read-only: it never publishes.
 */
import { loadManifest, publicVersionOf, type ChannelId, type ReleaseManifest } from "./release-manifest.ts";
import { parse as parseSums } from "./sums.ts";
import { findGhostVersions, type Packument } from "./npm-ghost-versions.ts";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface ChannelResult {
  channel: ChannelId;
  ok: boolean;
  detail: string;
  problems: string[];
}

/** Assets the bootstrap installers and package managers need from a release. */
export const REQUIRED_RELEASE_ASSETS = [
  "SHA256SUMS",
  "SHA256SUMS.bundle",
  "xr-source.tar.gz",
  "xr-linux-x64",
  "xr-linux-arm64",
  "xr-darwin-arm64",
  "xr-darwin-x64",
  "xr-windows-x64.exe",
  "xr-windows-x64.zip",
] as const;

/** Assets that must have a SHA256SUMS entry (everything except the sums and their signature). */
const SUMMED_ASSETS = REQUIRED_RELEASE_ASSETS.filter((a) => !a.startsWith("SHA256SUMS"));

export function repoSlug(manifest: ReleaseManifest): string {
  const m = manifest.identity.repo.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error(`identity.repo is not a GitHub URL: ${manifest.identity.repo}`);
  return m[1];
}

/** winget-pkgs layout: manifests/<lowercase first char>/<Publisher>/<Package...>/<version>/ */
export function wingetManifestDir(packageId: string, version: string): string {
  const parts = packageId.split(".");
  return `manifests/${packageId[0].toLowerCase()}/${parts.join("/")}/${version}`;
}

interface Ctx {
  manifest: ReleaseManifest;
  version: string;
  repo: string;
  fetch: Fetcher;
  ghToken?: string;
  sums?: Map<string, string> | null;
}

function gh(ctx: Ctx, path: string): Promise<Response> {
  return ctx.fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "xr-channel-live-check",
      ...(ctx.ghToken ? { authorization: `Bearer ${ctx.ghToken}` } : {}),
    },
  });
}

async function text(ctx: Ctx, url: string): Promise<{ status: number; body: string }> {
  const res = await ctx.fetch(url, { headers: { "user-agent": "xr-channel-live-check" } });
  return { status: res.status, body: res.ok ? await res.text() : "" };
}

/** The release's SHA256SUMS (memoised); null when unavailable. */
async function releaseSums(ctx: Ctx): Promise<Map<string, string> | null> {
  if (ctx.sums !== undefined) return ctx.sums;
  const r = await text(ctx, `https://github.com/${ctx.repo}/releases/download/v${ctx.version}/SHA256SUMS`);
  ctx.sums = r.status === 200 ? parseSums(r.body) : null;
  return ctx.sums;
}

function result(channel: ChannelId, problems: string[], okDetail: string): ChannelResult {
  return { channel, ok: problems.length === 0, problems, detail: problems.length === 0 ? okDetail : problems[0] };
}

async function checkGithub(ctx: Ctx): Promise<ChannelResult> {
  const problems: string[] = [];
  const tag = `v${ctx.version}`;
  const rel = await gh(ctx, `/repos/${ctx.repo}/releases/tags/${tag}`);
  if (rel.status !== 200) {
    return result("github-releases", [`release ${tag} not found (HTTP ${rel.status})`], "");
  }
  const body = (await rel.json()) as { draft?: boolean; prerelease?: boolean; assets?: Array<{ name: string }> };
  if (body.draft) problems.push(`release ${tag} is a draft`);
  if (body.prerelease) problems.push(`release ${tag} is marked pre-release`);
  const names = new Set((body.assets ?? []).map((a) => a.name));
  const missing = REQUIRED_RELEASE_ASSETS.filter((a) => !names.has(a));
  if (missing.length) problems.push(`release ${tag} is missing assets: ${missing.join(", ")}`);
  const sums = await releaseSums(ctx);
  if (!sums) {
    problems.push(`SHA256SUMS for ${tag} could not be downloaded`);
  } else {
    const unsummed = SUMMED_ASSETS.filter((a) => names.has(a) && !sums.has(a));
    if (unsummed.length) problems.push(`assets without a SHA256SUMS entry: ${unsummed.join(", ")}`);
  }
  const latest = await gh(ctx, `/repos/${ctx.repo}/releases/latest`);
  if (latest.status === 200) {
    const l = (await latest.json()) as { tag_name?: string };
    if (l.tag_name !== tag) {
      problems.push(`GitHub "Latest" release is ${l.tag_name ?? "unknown"}, not ${tag} (mark newer unpublished releases as pre-release)`);
    }
  } else {
    problems.push(`could not resolve the GitHub "Latest" release (HTTP ${latest.status})`);
  }
  for (const w of ctx.manifest.channels?.withdrawnTags ?? []) {
    const wr = await gh(ctx, `/repos/${ctx.repo}/releases/tags/${w.tag}`);
    if (wr.status === 200) {
      const wb = (await wr.json()) as { prerelease?: boolean };
      if (!wb.prerelease) problems.push(`withdrawn ${w.tag} is a full (non-pre-release) GitHub release; mark it pre-release`);
    }
  }
  return result("github-releases", problems, `${tag} is Latest with ${REQUIRED_RELEASE_ASSETS.length} required assets, all summed`);
}

async function checkNpm(ctx: Ctx): Promise<ChannelResult> {
  const problems: string[] = [];
  const name = ctx.manifest.identity.name;
  const res = await ctx.fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
    headers: { accept: "application/json" },
  });
  if (res.status !== 200) return result("npm", [`registry returned HTTP ${res.status} for ${name}`], "");
  const body = (await res.json()) as Packument;
  const latest = body["dist-tags"]?.latest;
  if (latest !== ctx.version) problems.push(`npm dist-tag latest is ${latest ?? "unset"}, expected ${ctx.version}`);
  if (!body.versions?.[ctx.version]) problems.push(`npm has no version ${ctx.version}`);
  for (const w of ctx.manifest.channels?.withdrawnTags ?? []) {
    if (body.versions?.[w.tag.slice(1)]) problems.push(`withdrawn ${w.tag} is published on npm`);
  }
  // XR-LAUNCH-023: versions above the latest major must be deprecated → @latest
  // (owner fix: `bun run npm:ghosts -- --print-commands`).
  if (latest) for (const p of findGhostVersions(body, name).problems) problems.push(`${p} (owner: bun run npm:ghosts -- --print-commands)`);
  return result("npm", problems, `latest = ${ctx.version}`);
}

/** Extract url → sha256 pairs from a Homebrew formula (url line followed by its sha256 line). */
export function formulaPairs(formula: string): Array<{ url: string; sha: string }> {
  const out: Array<{ url: string; sha: string }> = [];
  const re = /url\s+"([^"]+)"\s*\n\s*sha256\s+"([0-9a-fA-F]{64})"/g;
  for (let m = re.exec(formula); m; m = re.exec(formula)) out.push({ url: m[1], sha: m[2].toLowerCase() });
  return out;
}

async function checkHomebrew(ctx: Ctx): Promise<ChannelResult> {
  const tap = ctx.manifest.channels?.homebrewTap ?? "";
  const r = await text(ctx, `https://raw.githubusercontent.com/${tap}/HEAD/Formula/xr.rb`);
  if (r.status !== 200) {
    return result("homebrew", [`tap ${tap} has no Formula/xr.rb (HTTP ${r.status}); publish with .github/workflows/publish-channels.yml`], "");
  }
  const problems: string[] = [];
  const declared = r.body.match(/^\s*version\s+"([^"]+)"/m)?.[1];
  if (declared !== ctx.version) problems.push(`formula declares version ${declared ?? "none"}, expected ${ctx.version}`);
  const pairs = formulaPairs(r.body);
  if (pairs.length === 0) problems.push("formula has no url/sha256 pairs");
  const sums = await releaseSums(ctx);
  for (const { url, sha } of pairs) {
    if (!url.includes(`/releases/download/v${ctx.version}/`)) problems.push(`formula url is not pinned to v${ctx.version}: ${url}`);
    const file = url.split("/").pop() ?? "";
    const want = sums?.get(file);
    if (!want) problems.push(`formula references ${file}, which has no SHA256SUMS entry`);
    else if (want !== sha) problems.push(`formula sha256 for ${file} does not match the signed SHA256SUMS`);
  }
  const tapName = tap.replace("/homebrew-", "/");
  return result("homebrew", problems, `brew install ${tapName}/xr → ${ctx.version}`);
}

async function checkWinget(ctx: Ctx): Promise<ChannelResult> {
  const id = ctx.manifest.channels?.wingetPackageId ?? "";
  const dir = wingetManifestDir(id, ctx.version);
  const r = await text(ctx, `https://raw.githubusercontent.com/microsoft/winget-pkgs/master/${dir}/${id}.installer.yaml`);
  if (r.status !== 200) {
    return result("winget", [`microsoft/winget-pkgs has no ${id} ${ctx.version} (HTTP ${r.status}); submission pending or not merged`], "");
  }
  const problems: string[] = [];
  const sums = await releaseSums(ctx);
  const want = sums?.get("xr-windows-x64.zip");
  const shas = [...r.body.matchAll(/InstallerSha256:\s*([0-9a-fA-F]{64})/g)].map((m) => m[1].toLowerCase());
  if (!want) problems.push("release SHA256SUMS has no xr-windows-x64.zip entry");
  else if (!shas.includes(want)) problems.push(`winget installer sha256 does not match the signed xr-windows-x64.zip`);
  return result("winget", problems, `winget install ${id} → ${ctx.version}`);
}

async function checkScoop(ctx: Ctx): Promise<ChannelResult> {
  const r = await text(ctx, `https://github.com/${ctx.repo}/releases/download/v${ctx.version}/xr.json`);
  if (r.status !== 200) return result("scoop", [`release v${ctx.version} has no xr.json scoop manifest (HTTP ${r.status})`], "");
  const problems: string[] = [];
  let doc: { version?: string; architecture?: Record<string, { url?: string; hash?: string }> };
  try {
    doc = JSON.parse(r.body);
  } catch {
    return result("scoop", ["xr.json is not valid JSON"], "");
  }
  if (doc.version !== ctx.version) problems.push(`xr.json declares ${doc.version ?? "none"}, expected ${ctx.version}`);
  const sums = await releaseSums(ctx);
  for (const [arch, entry] of Object.entries(doc.architecture ?? {})) {
    const file = (entry.url ?? "").split("/").pop() ?? "";
    const want = sums?.get(file);
    if (!want) problems.push(`xr.json ${arch} references ${file}, which has no SHA256SUMS entry`);
    else if ((entry.hash ?? "").toLowerCase() !== want) problems.push(`xr.json ${arch} hash does not match the signed ${file}`);
  }
  return result("scoop", problems, `scoop install <release>/xr.json → ${ctx.version}`);
}

async function checkDocker(ctx: Ctx): Promise<ChannelResult> {
  const image = ctx.manifest.channels?.dockerImage ?? "";
  const [registry, ...rest] = image.split("/");
  const path = rest.join("/");
  if (registry !== "ghcr.io") return result("docker", [`only ghcr.io images are checked (got ${registry})`], "");
  const tokRes = await ctx.fetch(`https://ghcr.io/token?scope=repository:${path}:pull`);
  if (tokRes.status !== 200) return result("docker", [`GHCR token request failed (HTTP ${tokRes.status})`], "");
  const token = ((await tokRes.json()) as { token?: string }).token ?? "";
  const accept = [
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.v2+json",
  ].join(", ");
  const digest = async (tag: string): Promise<string | null> => {
    const res = await ctx.fetch(`https://ghcr.io/v2/${path}/manifests/${tag}`, {
      method: "HEAD",
      headers: { authorization: `Bearer ${token}`, accept },
    });
    return res.status === 200 ? res.headers.get("docker-content-digest") : null;
  };
  const problems: string[] = [];
  const v = await digest(ctx.version);
  const latest = await digest("latest");
  if (!v) problems.push(`${image}:${ctx.version} does not exist`);
  if (!latest) problems.push(`${image}:latest does not exist`);
  if (v && latest && v !== latest) problems.push(`${image}:latest is not ${ctx.version} (digests differ)`);
  return result("docker", problems, `${image}:${ctx.version} == :latest`);
}

const CHECKS: Record<ChannelId, (ctx: Ctx) => Promise<ChannelResult>> = {
  "github-releases": checkGithub,
  npm: checkNpm,
  homebrew: checkHomebrew,
  winget: checkWinget,
  scoop: checkScoop,
  docker: checkDocker,
};

export async function runLiveChecks(
  manifest: ReleaseManifest,
  opts: { fetch?: Fetcher; version?: string; channels?: ChannelId[]; ghToken?: string } = {},
): Promise<ChannelResult[]> {
  const ctx: Ctx = {
    manifest,
    version: (opts.version ?? publicVersionOf(manifest)).replace(/^v/, ""),
    repo: repoSlug(manifest),
    fetch: opts.fetch ?? ((url, init) => fetch(url, init)),
    ghToken: opts.ghToken,
  };
  const wanted = opts.channels ?? manifest.channels?.claimed ?? ["github-releases", "npm"];
  const out: ChannelResult[] = [];
  for (const channel of wanted) {
    try {
      out.push(await CHECKS[channel](ctx));
    } catch (err) {
      out.push(result(channel, [`check errored: ${err instanceof Error ? err.message : String(err)}`], ""));
    }
  }
  return out;
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const manifest = loadManifest();
  const version = argValue(argv, "--version");
  const only = argValue(argv, "--channels");
  const channels = only ? (only.split(",").map((c) => c.trim()).filter(Boolean) as ChannelId[]) : undefined;
  for (const c of channels ?? []) {
    if (!(c in CHECKS)) {
      console.error(`[channel:live] unknown channel "${c}" (known: ${Object.keys(CHECKS).join(", ")})`);
      process.exit(2);
    }
  }
  const results = await runLiveChecks(manifest, {
    version,
    channels,
    ghToken: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  });
  const target = (version ?? publicVersionOf(manifest)).replace(/^v/, "");
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ version: target, ok: results.every((r) => r.ok), results }, null, 2));
  } else {
    console.log(`[channel:live] public channels for v${target} (live registries, read-only)`);
    for (const r of results) {
      console.log(`  ${r.ok ? " ok " : "FAIL"}  ${r.channel.padEnd(16)} ${r.detail}`);
      for (const p of r.problems.slice(1)) console.log(`        ${"".padEnd(16)} ${p}`);
    }
  }
  if (!results.every((r) => r.ok)) {
    if (!argv.includes("--json")) {
      console.error(`[channel:live] FAIL — ${results.filter((r) => !r.ok).length} claimed channel(s) do not serve v${target}.`);
    }
    process.exit(1);
  }
  if (!argv.includes("--json")) console.log(`[channel:live] PASS — every claimed channel serves v${target}.`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[channel:live] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
