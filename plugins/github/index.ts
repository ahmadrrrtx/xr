/**
 * XR 1.0 reference integration plugin — "github".
 *
 * Demonstrates a *permissioned* plugin. It declares `net` and `secrets`, so its
 * host exposes `host.net` and `host.secrets` — but ONLY those. It still cannot:
 *   • reach a host that is not on the user's egress allow-list (host.net gates it)
 *   • read any secret value into a log (host.secrets.get audits the NAME only)
 *   • touch the user's filesystem, memory, provider, or shell (not granted)
 *
 * Requirements to actually fetch:
 *   • "api.github.com" must be on security.egressAllowlist (it is by default)
 *   • optional: a GITHUB_TOKEN secret (xr providers / secret store) raises limits
 *
 * Contributes:
 *   • command  → `xr plugin github repo <owner/name>`
 *   • tool     → `plugin.github.repo` (offered to the agent, approval-gated)
 */
import type { PluginHost, PluginContributions } from "../../src/plugins/types.ts";

interface RepoInfo {
  full_name?: string;
  description?: string;
  stargazers_count?: number;
  language?: string;
  html_url?: string;
  message?: string; // error path
}

async function fetchRepo(host: PluginHost, slug: string): Promise<string> {
  const clean = slug.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
  if (!/^[^/]+\/[^/]+$/.test(clean)) {
    return `invalid repo "${slug}" — expected owner/name`;
  }
  const url = `https://api.github.com/repos/${clean}`;
  if (!host.net) return "network permission not granted";
  if (!host.net.isAllowed(url)) {
    return `egress not allowed for api.github.com — add it to security.egressAllowlist`;
  }

  const headers: Record<string, string> = { "user-agent": "xr-plugin-github" };
  // Optional auth: read the token by NAME; the value is never logged.
  const token = host.secrets?.get("GITHUB_TOKEN");
  if (token) headers["authorization"] = `Bearer ${token}`;

  try {
    const res = await host.net.fetch(url, { headers });
    if (!res.ok) return `GitHub API ${res.status} for ${clean}`;
    const data = (await res.json()) as RepoInfo;
    if (data.message) return `GitHub: ${data.message}`;
    return [
      `${data.full_name}`,
      data.description ? `  ${data.description}` : "",
      `  ★ ${data.stargazers_count ?? 0}   ${data.language ?? "?"}`,
      `  ${data.html_url}`,
    ]
      .filter(Boolean)
      .join("\n");
  } catch (e) {
    return `fetch failed: ${(e as Error).message}`;
  }
}

export function activate(host: PluginHost): PluginContributions {
  return {
    commands: [
      {
        name: "repo",
        description: "Show info about a public GitHub repo (owner/name).",
        async run(argv) {
          const out = await fetchRepo(host, argv[0] ?? "");
          host.log(out);
        },
      },
    ],
    tools: [
      {
        name: "repo",
        description: "Look up a public GitHub repository by owner/name. Returns stars, language, description.",
        parameters: { repo: "string (owner/name)" },
        requiresApproval: true, // network call → confirm
        async run(args) {
          const out = await fetchRepo(host, String(args.repo ?? ""));
          return { ok: !out.startsWith("invalid") && !out.startsWith("egress"), output: out };
        },
      },
    ],
  };
}

export default activate;
