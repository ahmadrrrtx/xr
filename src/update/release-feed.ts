/**
 * The newest COMPLETE XR release on GitHub: published, not a pre-release, and
 * carrying SHA256SUMS (a desktop-only or half-published release is never "an
 * update"). Shared by `xr update --check` (check.ts) and the binary-layout
 * updater (atomic-updater.ts, XR-LAUNCH-019). A leaf module: it must not import
 * either of them (dependency-cruiser no-circular).
 */

/** Newest published, non-pre-release GitHub release that carries SHA256SUMS. */
export async function latestCompleteRelease(
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
): Promise<string | null> {
  const { compareSemver } = await import("../skills/semver.ts");
  try {
    const { endpointOverride } = await import("./npm-channel.ts");
    const api = endpointOverride(process.env.XR_UPDATE_RELEASES_URL) ?? "https://api.github.com/repos/ahmadrrrtx/xr/releases?per_page=20";
    const res = await fetcher(api, {
      headers: { accept: "application/vnd.github+json", "user-agent": "xr-update-check" },
    });
    if (!res.ok) return null;
    const list = (await res.json()) as Array<{ tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: Array<{ name?: string }> }>;
    let best: string | null = null;
    for (const r of list) {
      if (r.draft || r.prerelease || !r.tag_name) continue;
      if (!r.assets?.some((a) => a.name === "SHA256SUMS")) continue;
      const v = r.tag_name.replace(/^v/, "");
      if (!best || compareSemver(v, best) > 0) best = v;
    }
    return best;
  } catch {
    return null;
  }
}
