import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { InstallCmd } from "@/components/InstallCmd";
import { Apple, Binary, Terminal as Term, ExternalLink, Package } from "lucide-react";
import { WindowsIcon } from "@/components/icons";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Downloads",
  description:
    "Download XR for macOS, Windows and Linux, or install the CLI with npm. Open-source and local-first; SHA-256 hashes are published with every GitHub release.",
};

const RELEASES = "https://github.com/ahmadrrrtx/xr/releases";

// Phase 31 · C15 — before per-platform binaries are attached to a release,
// every card goes to the GitHub releases page and says so. No dead links.
const platforms = [
  { icon: Apple, label: "macOS (Apple Silicon)", note: "macOS 13+ · ARM64 build", version: site.version, href: RELEASES },
  { icon: Apple, label: "macOS (Intel)", note: "macOS 13+ · x86_64 build", version: site.version, href: RELEASES },
  { icon: WindowsIcon, label: "Windows x64", note: "Windows 10+ · WSL2 recommended", version: site.version, href: RELEASES },
  { icon: Binary, label: "Linux (AppImage)", note: "Ubuntu 22.04+ / Fedora 38+ · portable", version: site.version, href: RELEASES },
  { icon: Binary, label: "Linux (.deb)", note: "Ubuntu 22.04+ / Debian · package install", version: site.version, href: RELEASES },
  { icon: Term, label: "npm CLI", note: "Linux · macOS · Windows with Bun 1.3+ · `npm i -g @rrrtx/xr`", version: site.publicVersion, href: "#install" },
];

export default function DownloadsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Download"
        title="Install XR anywhere."
        subtitle="Native binaries for every platform, extensions for every editor. Open-source, local-first."
      />
      <section>
        <div className="mx-auto max-w-5xl px-6">
          <div id="install" className="card p-8 text-center scroll-mt-32">
            <div className="text-sm text-zinc-400">Quick install</div>
            <div className="mt-4 flex justify-center">
              <div className="w-full max-w-md">
                <InstallCmd />
              </div>
            </div>
            <div className="mt-6 text-xs text-zinc-500">Requires Node 20+ · Full install ≈ 40MB</div>
          </div>

          <h2 className="mt-14 text-xl font-semibold text-white">Platforms</h2>
          <div className="mt-5 grid md:grid-cols-3 gap-5">
            {platforms.map((p) => (
              <a
                key={p.label}
                href={p.href}
                {...(p.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
                className="card p-6 group flex flex-col"
              >
                <p.icon className="h-7 w-7 text-zinc-300" />
                <div className="mt-4 text-lg font-semibold text-white">{p.label}</div>
                <div className="text-xs text-zinc-500 mt-1">v{p.version}</div>
                <div className="text-sm text-zinc-400 mt-2 flex-1">{p.note}</div>
                <div className="mt-4 btn btn-ghost w-full justify-center group-hover:text-white">
                  <Package className="h-4 w-4" /> {p.href === RELEASES ? "Download from GitHub" : "Install below"}
                </div>
              </a>
            ))}
          </div>

          <div className="mt-10 grid gap-3 text-sm text-zinc-400 md:grid-cols-2">
            <div className="card p-5">
              <div className="font-medium text-white">Requirements</div>
              <p className="mt-1.5 leading-relaxed">
                macOS 13 or later, Windows 10 or later, Ubuntu 22.04+ / Fedora 38+ on Linux. The npm CLI
                needs Node 20+.
              </p>
            </div>
            <div className="card p-5">
              <div className="font-medium text-white">Checksums</div>
              <p className="mt-1.5 leading-relaxed">
                SHA-256 hashes are published with every GitHub release — verify your download against the
                hash on the{" "}
                <a href={RELEASES} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
                  releases page
                </a>{" "}
                before running it.
              </p>
            </div>
          </div>

          <div className="mt-14 card p-8">
            <h2 className="text-lg font-semibold text-white">Verify your install</h2>
            <div className="mt-4 grid gap-3 font-mono text-sm">
              <Code code="xr --version" comment="prints version number" />
              <Code code="xr doctor" comment="checks runtime health" />
              <Code code="xr" comment="launches the assistant" />
            </div>
            <Link href="/docs" className="btn btn-ghost mt-6">
              <ExternalLink className="h-4 w-4" /> Installation guide
            </Link>
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
      <code className="text-zinc-100 flex-1">{code}</code>
      <span className="text-zinc-500 text-xs"># {comment}</span>
    </div>
  );
}
