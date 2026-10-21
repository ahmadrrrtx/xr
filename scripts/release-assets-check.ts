#!/usr/bin/env bun
/**
 * Launch-audit L-010 — release asset-completeness gate.
 *
 * v1.1.0 shipped with FIVE assets (desktop bundles from the desktop workflow's
 * own attach step) while the release pipeline had died at its gates job:
 * no CLI binaries, no SHA256SUMS, no npm tarball, no .deb, no intoto. Nothing
 * failed loudly anywhere users or maintainers looked — install.sh silently
 * fell back to a source checkout and npm sat two months stale.
 *
 * This gate makes that class impossible to repeat: after the release step
 * publishes, the live asset list of the tag's GitHub Release is asserted
 * against the canonical set the pipeline is responsible for. Missing ⇒ the
 * tag run goes RED where everyone can see it, not at a user's 404.
 *
 * Usage:
 *   bun run scripts/release-assets-check.ts --tag v1.2.3 [--repo owner/name]
 *     [--assets-json file]      # offline/test mode: check a stored list
 *
 * In CI the step runs with GH_TOKEN set; locally, public releases read fine
 * unauthenticated (rate-limited).
 */

/** Canonical CLI/npm assets the tag pipeline (release.yml) owns. Desktop
 * installers attach from desktop-app.yml and are asserted per-leg there. */
export function requiredAssets(version: string): Array<{ pattern: RegExp; label: string }> {
  const v = version.replace(/^v/, "");
  const esc = v.replace(/\./g, "\\.");
  return [
    { pattern: /^xr-linux-x64$/, label: "CLI binary linux-x64" },
    { pattern: /^xr-linux-arm64$/, label: "CLI binary linux-arm64" },
    { pattern: /^xr-darwin-arm64$/, label: "CLI binary darwin-arm64" },
    { pattern: /^xr-darwin-x64$/, label: "CLI binary darwin-x64" },
    { pattern: /^xr-windows-x64\.exe$/, label: "CLI binary windows-x64" },
    { pattern: /^xr-windows-arm64\.exe$/, label: "CLI binary windows-arm64 (L-004)" },
    { pattern: /^xr-windows-x64\.zip$/, label: "portable zip windows-x64" },
    { pattern: /^xr-windows-arm64\.zip$/, label: "portable zip windows-arm64 (L-004)" },
    { pattern: /^xr-source\.tar\.gz$/, label: "source archive" },
    { pattern: new RegExp(`^xr_${esc}_amd64\\.deb$`), label: ".deb channel artifact" },
    { pattern: new RegExp(`^rrrtx-xr-${esc}\\.tgz$`), label: "npm tarball" },
    { pattern: new RegExp(`^rrrtx-xr-${esc}\\.tgz\\.bundle$`), label: "npm tarball cosign bundle" },
    { pattern: /^SHA256SUMS$/, label: "checksum manifest" },
    { pattern: /^SHA256SUMS\.bundle$/, label: "checksum cosign bundle" },
    { pattern: /^sbom\.cyclonedx\.json$/, label: "SBOM" },
    { pattern: /^sbom\.cyclonedx\.json\.bundle$/, label: "SBOM cosign bundle" },
    { pattern: /^multiple\.intoto\.jsonl$/, label: "SLSA provenance bundle" },
  ];
}

export function missingAssets(version: string, assetNames: string[]): string[] {
  const names = new Set(assetNames.filter(Boolean));
  return requiredAssets(version)
    .filter((req) => !assetNames.some((a) => req.pattern.test(a)) && !names.has(req.label))
    .map((req) => `${req.label} (${req.pattern.source})`);
}

interface ReleaseAssetsResponse {
  tag_name?: string;
  assets?: Array<{ name?: string }>;
  message?: string;
}

async function fetchAssetNames(repo: string, tag: string): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}),
      "user-agent": "xr-release-assets-check",
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}@${tag}: ${res.statusText}`);
  const data = (await res.json()) as ReleaseAssetsResponse;
  return (data.assets ?? []).map((a) => a.name ?? "").filter(Boolean);
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const tag = get("--tag");
  const repo = get("--repo") ?? "ahmadrrrtx/xr";
  const offline = get("--assets-json");
  if (!tag) {
    console.error("usage: release-assets-check.ts --tag <vX.Y.Z> [--repo owner/name] [--assets-json file]");
    process.exit(2);
  }
  const assetNames = offline
    ? (JSON.parse(require("node:fs").readFileSync(offline, "utf8")) as string[])
    : await fetchAssetNames(repo, tag);
  const missing = missingAssets(tag, assetNames);
  console.log(`[release-assets] ${repo}@${tag}: ${assetNames.length} asset(s) live; canonical set = ${requiredAssets(tag).length}`);
  if (missing.length > 0) {
    for (const m of missing) console.error(`  MISSING  ${m}`);
    console.error(
      "[release-assets] FAIL — the release is incomplete. Do NOT announce it; rerun the failed pipeline jobs first (L-010).",
    );
    process.exit(1);
  }
  console.log("[release-assets] PASS — canonical asset set is complete on the live release.");
}
