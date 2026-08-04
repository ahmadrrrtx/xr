import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { InstallCmd } from "@/components/InstallCmd";
import { ExternalLink, Package, ShieldCheck, AlertTriangle, Terminal } from "lucide-react";
import { site } from "@/lib/site";
import { XR_DISTRIBUTION } from "@/lib/distribution";

export const metadata: Metadata = { title: "Downloads" };

/**
 * Phase 9 · T6 — this page shows ONLY distribution channels that exist in the
 * release manifest (one canonical build → many channels), each with its real
 * install command. No dead cards, no fictional integrations (Constitution
 * Article X / XIX). The historical editor-integration cards and placeholder
 * download hrefs were removed under the deletion budget — see
 * docs/phase-9/01-AUDIT-REPORT.md (P11). Fictional "editor extensions" never
 * existed; claiming them was a defect.
 */

const releaseUrl = `${site.github}/releases/latest`;

function channelIcon(kind: string) {
  switch (kind) {
    case "package-manager":
      return Package;
    case "container":
      return Package;
    default:
      return Terminal;
  }
}

export default function DownloadsPage() {
  const d = XR_DISTRIBUTION;
  return (
    <>
      <PageHeader
        eyebrow="Download"
        title={`Install XR — ${d.displayVersion}.`}
        subtitle={`One canonical build, signed and checksum-pinned, published to every channel below. ${d.stabilityLabel}: validated and reversible — and not finished.`}
      />
      <section>
        <div className="mx-auto max-w-5xl px-6">
          {/* Beta stamp — one truth, from the release manifest */}
          <div className="card p-6 border-amber-500/30 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-amber-200">{d.stabilityLabel}</div>
                <p className="text-sm text-zinc-400 mt-1">
                  {d.tagline} Read the{" "}
                  <a className="text-amber-300 underline" href={d.knownLimitationsUrl}>
                    known limitations
                  </a>{" "}
                  before relying on XR for high-stakes work, and{" "}
                  <a className="text-amber-300 underline" href={d.verifyingUrl}>
                    verify every download
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>

          <div className="card p-8 text-center mt-6">
            <div className="text-sm text-zinc-400">Quickest install (Linux · macOS · Windows PowerShell)</div>
            <div className="mt-4 flex justify-center">
              <div className="w-full max-w-xl">
                <InstallCmd />
              </div>
            </div>
            <div className="mt-5 text-xs text-zinc-500">
              Windows:{" "}
              <code className="text-zinc-400">iex (irm {site.github.replace("https://github.com", "https://raw.githubusercontent.com")}/main/install.ps1)</code>
              {" · "}verifies the download against the release SHA256SUMS before trusting it.
            </div>
          </div>

          <h2 className="mt-14 text-xl font-semibold text-white">
            Channels <span className="text-sm font-normal text-zinc-500">(updated with every release — versions stay in sync)</span>
          </h2>
          <div className="mt-5 grid md:grid-cols-2 gap-4">
            {d.channels.map((c) => {
              const Icon = channelIcon(c.kind);
              return (
                <div key={c.id} className="card p-5">
                  <div className="flex items-center gap-3">
                    <Icon className="h-5 w-5 text-zinc-400" />
                    <div className="text-sm font-medium text-white">{c.id}</div>
                    <div className="ml-auto text-[11px] rounded-full border border-white/10 px-2 py-0.5 text-zinc-400">
                      {c.tier === 1 ? "tier 1" : "tier 2"} · {c.os.join("/")}
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500 mt-2">{c.summary}</p>
                  <div className="mt-3 rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[13px] text-zinc-200 overflow-x-auto">
                    $ {c.install.replace("<version>", d.version)}
                  </div>
                  <div className="mt-2 text-[11px] text-zinc-600">
                    update: <code>{c.update.replace("<new-version>", "next")}</code>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-14 card p-8">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-400" /> Verify your download
            </h2>
            <p className="text-sm text-zinc-500 mt-2">
              Every release asset ships with a cosign keyless signature recorded in the public Rekor log,
              SHA256SUMS, a CycloneDX SBOM and SLSA provenance. Full instructions and identity:
            </p>
            <div className="mt-4 grid gap-3">
              <Code code={`sha256sum -c SHA256SUMS`} comment="integrity, from the release page" />
              <Code
                code={`cosign verify-blob --certificate-identity '${site.github}/.github/workflows/release.yml@refs/tags/v*' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' --bundle <asset>.bundle <asset>`}
                comment="keyless signature (Rekor)"
              />
              <Code code={site.installCmd.split(" && ")[0]!} comment="then: xr doctor to confirm health" />
            </div>
            <a href={d.verifyingUrl} className="btn btn-ghost mt-6" target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" /> Verifying releases (full guide)
            </a>
          </div>

          <div className="mt-8 text-sm text-zinc-500">
            Direct downloads for every platform live on the{" "}
            <a className="text-zinc-300 underline" href={releaseUrl} target="_blank" rel="noreferrer">
              GitHub releases page
            </a>
            . Prereleases (tags ending <code>-beta.N</code>) are the beta channel; nothing about them is implied stable.
          </div>
        </div>
      </section>
    </>
  );
}

function Code({ code, comment }: { code: string; comment: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 px-4 py-3 flex items-center gap-3">
      <span className="text-violet-300">$</span>
      <code className="text-zinc-100 flex-1 text-xs md:text-sm overflow-x-auto">{code}</code>
      <span className="text-zinc-500 text-xs shrink-0"># {comment}</span>
    </div>
  );
}
