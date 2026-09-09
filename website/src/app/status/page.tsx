import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { site } from "@/lib/site";
import { ExternalLink, Terminal as Term, ShieldCheck, Package, Activity } from "lucide-react";
import { GithubIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Status" };

export const revalidate = 600; // refresh live data every 10 minutes

interface NpmInfo {
  latest?: string;
  beta?: string;
  published?: string;
  ok: boolean;
}
interface RepoInfo {
  stars?: number;
  openIssues?: number;
  pushedAt?: string;
  latestRelease?: string;
  ok: boolean;
}

async function getLive(): Promise<{ npm: NpmInfo; repo: RepoInfo }> {
  const npm: NpmInfo = { ok: false };
  const repo: RepoInfo = { ok: false };
  try {
    const r = await fetch("https://registry.npmjs.org/@rrrtx/xr", {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = (await r.json()) as { "dist-tags"?: Record<string, string>; time?: Record<string, string> };
      npm.latest = j["dist-tags"]?.latest;
      npm.beta = j["dist-tags"]?.beta;
      npm.published = j.time?.[npm.latest ?? ""];
      npm.ok = true;
    }
  } catch {
    /* network unavailable — fall back to static text */
  }
  try {
    const r = await fetch("https://api.github.com/repos/ahmadrrrtx/xr", {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = (await r.json()) as { stargazers_count?: number; open_issues_count?: number; pushed_at?: string };
      repo.stars = j.stargazers_count;
      repo.openIssues = j.open_issues_count;
      repo.pushedAt = j.pushed_at;
      repo.ok = true;
    }
    const rel = await fetch("https://api.github.com/repos/ahmadrrrtx/xr/releases/latest", {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(6000),
    });
    if (rel.ok) {
      const j = (await rel.json()) as { tag_name?: string };
      repo.latestRelease = j.tag_name;
    }
  } catch {
    /* keep static fallback */
  }
  return { npm, repo };
}

export default async function StatusPage() {
  const { npm, repo } = await getLive();

  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="Self-hosted software. Honest status."
        subtitle="XR is not a hosted service — there is no XR cloud to have an outage. This page reports the real signals that matter: the published package, the repository, and your own machine."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6 space-y-4">
          {/* Framing card */}
          <div className="card card-hover flex items-start gap-4 p-6">
            <div className="icon-tile h-11 w-11 shrink-0 rounded-xl">
              <ShieldCheck className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <div className="font-semibold text-white">What &ldquo;status&rdquo; means for XR</div>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                The software runs on your machine and reports to nothing. No servers, no uptime
                board, no telemetry. The only live status that matters is yours: run{" "}
                <code className="font-mono text-cyan-300">xr doctor</code> to check the runtime,
                provider health, memory store and audit chain in one pass.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {["No cloud control plane", "No telemetry", "No accounts", "MIT-licensed"].map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-400"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Live signals */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card card-hover p-6">
              <div className="flex items-center gap-2.5">
                <div className="icon-tile h-9 w-9 rounded-lg">
                  <Package className="h-4 w-4 text-cyan-300" />
                </div>
                <div className="text-sm font-semibold text-white">npm — @rrrtx/xr</div>
                {npm.ok ? (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" /> live
                  </span>
                ) : (
                  <span className="ml-auto text-[11px] text-zinc-500">cached</span>
                )}
              </div>
              {npm.ok ? (
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">latest (stable)</dt>
                    <dd className="font-mono text-zinc-200">{npm.latest ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">beta (pre-release)</dt>
                    <dd className="font-mono text-zinc-200">{npm.beta ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">latest published</dt>
                    <dd className="font-mono text-zinc-200">
                      {npm.published ? new Date(npm.published).toUTCString().slice(0, 16) : "—"}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">
                  Live registry data is unavailable right now. Current stable line: v
                  {site.version} ({site.codename}).
                </p>
              )}
              <a
                href={site.npm}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-cyan-300"
              >
                View on npm <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            <div className="card card-hover p-6">
              <div className="flex items-center gap-2.5">
                <div className="icon-tile h-9 w-9 rounded-lg">
                  <GithubIcon className="h-4 w-4 text-violet-300" />
                </div>
                <div className="text-sm font-semibold text-white">Repository — ahmadrrrtx/xr</div>
                {repo.ok && (
                  <span className="ml-auto flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" /> live
                  </span>
                )}
              </div>
              {repo.ok ? (
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">open issues</dt>
                    <dd className="font-mono text-zinc-200 tabular-nums">{repo.openIssues ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">stars</dt>
                    <dd className="font-mono text-zinc-200 tabular-nums">{repo.stars ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">last push</dt>
                    <dd className="font-mono text-zinc-200">
                      {repo.pushedAt ? new Date(repo.pushedAt).toUTCString().slice(0, 16) : "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">latest release</dt>
                    <dd className="font-mono text-zinc-200">{repo.latestRelease ?? "—"}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-4 text-sm text-zinc-500">
                  Live repository data is unavailable right now — the repo is
                  github.com/ahmadrrrtx/xr.
                </p>
              )}
              <a
                href={site.github}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-cyan-300"
              >
                View on GitHub <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Local check instructions */}
          <div className="card card-hover p-6">
            <div className="flex items-center gap-2.5">
              <div className="icon-tile h-9 w-9 rounded-lg">
                <Activity className="h-4 w-4 text-emerald-300" />
              </div>
              <div className="text-sm font-semibold text-white">Your machine — the real status page</div>
            </div>
            <div className="mt-4 grid gap-3 font-mono text-[13px] md:grid-cols-2">
              {[
                { cmd: "xr doctor", note: "runtime · provider · memory · audit — one pass" },
                { cmd: "xr providers status", note: "key status, health and active model" },
                { cmd: "xr audit verify", note: "proves the local log has not been tampered with" },
                { cmd: "xr serve", note: "open the local Control Center at 127.0.0.1:3141" },
              ].map((c) => (
                <div key={c.cmd} className="code-line">
                  <Term className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                  <code className="text-zinc-100">{c.cmd}</code>
                  <span className="ml-auto hidden pl-3 text-right text-[11px] text-zinc-500 sm:block">{c.note}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500">
              Data on this page is fetched live from the npm registry and the GitHub API and
              cached for ten minutes; if those sources are unreachable the page falls back to
              static facts rather than pretending.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
