import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { InstallCmd } from "@/components/InstallCmd";
import { Apple, Binary, Code2, Terminal as Term, ExternalLink, Package } from "lucide-react";
import { WindowsIcon } from "@/components/icons";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Downloads" };

const platforms = [
  { icon: Apple, label: "macOS", note: "Universal · Apple Silicon & Intel", version: site.version, href: "#" },
  { icon: WindowsIcon, label: "Windows", note: "Windows 10+ · WSL2 recommended", version: site.version, href: "#" },
  { icon: Binary, label: "Linux", note: "x86_64 & arm64 · .deb / .rpm / .tar.gz", version: site.version, href: "#" },
];

const editors = [
  { icon: Code2, label: "VS Code", note: "Extension pack", href: "#" },
  { icon: Term, label: "Neovim", note: "Plugin", href: "#" },
  { icon: Code2, label: "JetBrains", note: "IntelliJ / WebStorm / PyCharm", href: "#" },
  { icon: Code2, label: "Zed", note: "Extension", href: "#" },
  { icon: Code2, label: "Cursor", note: "Integration", href: "#" },
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
          <div className="card p-8 text-center">
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
              <a key={p.label} href={p.href} className="card p-6 group flex flex-col">
                <p.icon className="h-7 w-7 text-zinc-300" />
                <div className="mt-4 text-lg font-semibold text-white">{p.label}</div>
                <div className="text-xs text-zinc-500 mt-1">v{p.version}</div>
                <div className="text-sm text-zinc-400 mt-2 flex-1">{p.note}</div>
                <div className="mt-4 btn btn-ghost w-full justify-center group-hover:text-white">
                  <Package className="h-4 w-4" /> Download
                </div>
              </a>
            ))}
          </div>

          <h2 className="mt-14 text-xl font-semibold text-white">Editor integrations</h2>
          <div className="mt-5 grid md:grid-cols-3 lg:grid-cols-5 gap-4">
            {editors.map((e) => (
              <a key={e.label} href={e.href} className="card p-5 group">
                <e.icon className="h-5 w-5 text-zinc-400" />
                <div className="mt-3 text-sm font-medium text-white">{e.label}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{e.note}</div>
              </a>
            ))}
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
