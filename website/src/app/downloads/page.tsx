import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { InstallCmd } from "@/components/InstallCmd";
import { CopyButton } from "@/components/CopyButton";
import {
  ArrowRight,
  Terminal as Term,
  Package,
  FileCode2,
  ExternalLink,
  Container,
} from "lucide-react";
import { WindowsIcon, GithubIcon } from "@/components/icons";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Downloads" };

/** Every channel below is real — mirrors the README install table. */
const channels = [
  {
    icon: Term,
    label: "npm (stable)",
    note: "Runs the TypeScript sources; needs Bun ≥ 1.3.",
    cmd: "npm i -g @rrrtx/xr",
  },
  {
    icon: Term,
    label: "Binary — Linux · macOS · Termux · WSL",
    note: "Standalone executable, no runtime needed. Signed releases.",
    cmd: "curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash",
  },
  {
    icon: WindowsIcon,
    label: "Binary — Windows (PowerShell)",
    note: "Windows 10+, PowerShell 5.1 or 7+. Standalone executable.",
    cmd: "iex (irm https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.ps1)",
  },
  {
    icon: Package,
    label: "Homebrew (macOS · Linux)",
    note: "Unofficial tap maintained in the repo packaging channel.",
    cmd: "brew install ahmadrrrtx/tap/xr",
  },
  {
    icon: Package,
    label: "WinGet (Windows)",
    note: "Community manifests live under packaging/winget.",
    cmd: "winget install ahmadrrrtx.XR",
  },
  {
    icon: Container,
    label: "Docker",
    note: "Container image from the repo's Dockerfile.",
    cmd: "docker run ghcr.io/ahmadrrrtx/xr:latest",
  },
  {
    icon: FileCode2,
    label: "From source",
    note: "Clone, bun install, run. Great for contributing.",
    cmd: "git clone https://github.com/ahmadrrrtx/xr && cd xr && bun install",
  },
];

export default function DownloadsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Download"
        title="Install XR anywhere."
        subtitle="Every channel installs the same canonical build: MIT-licensed, local-first, no accounts. Pick the one that fits your machine."
      />
      <section>
        <div className="mx-auto max-w-5xl px-6">
          <div className="card card-hover p-8 text-center">
            <div className="text-sm text-zinc-400">Quick install</div>
            <div className="mt-4 flex justify-center">
              <div className="w-full max-w-md">
                <InstallCmd />
              </div>
            </div>
            <div className="mt-5 text-xs text-zinc-500">
              From npm you need Bun ≥ 1.3 · compiled binaries need nothing · v{site.version} ({site.codename})
            </div>
          </div>

          <h2 className="mt-14 text-xl font-semibold text-white">Install channels</h2>
          <p className="mt-1.5 text-sm text-zinc-500">
            Publication status per channel is tracked in{" "}
            <a
              className="text-cyan-300 hover:underline"
              href={`${site.github}/blob/main/docs/release/SUPPORT_MATRIX.md`}
              target="_blank"
              rel="noreferrer"
            >
              docs/release/SUPPORT_MATRIX.md
            </a>
            .
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {channels.map((c) => (
              <div key={c.label} className="card card-hover flex flex-col p-5">
                <div className="flex items-center gap-2.5">
                  <div className="icon-tile h-9 w-9 rounded-lg">
                    <c.icon className="h-4.5 w-4.5 h-5 w-5 text-cyan-300" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{c.label}</div>
                    <div className="mt-0.5 text-xs text-zinc-500">{c.note}</div>
                  </div>
                </div>
                <div className="code-line mt-4">
                  <code className="min-w-0 flex-1 truncate text-zinc-200">{c.cmd}</code>
                  <CopyButton text={c.cmd} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href="https://github.com/ahmadrrrtx/xr/releases"
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost"
            >
              <GithubIcon className="h-4 w-4" /> All releases & checksums
            </a>
          </div>

          <div className="card card-hover mt-12 p-8">
            <h2 className="text-lg font-semibold text-white">Verify your install</h2>
            <div className="mt-4 grid gap-3 font-mono text-sm">
              <Code code="xr --version" comment="prints 1.0.0 (Truth)" />
              <Code code="xr doctor" comment="checks runtime health end to end" />
              <Code code="xr" comment="launches the shell (default surface)" />
            </div>
            <p className="mt-4 text-sm text-zinc-500">
              First run? <code className="font-mono text-zinc-300">xr onboarding</code> guides you
              through connecting a model — local or BYOK.
            </p>
            <Link href="/docs" className="btn btn-ghost mt-6">
              <ExternalLink className="h-4 w-4" /> Documentation hub <ArrowRight className="arrow-nudge h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Code({ code, comment }: { code: string; comment: string }) {
  return (
    <div className="code-line">
      <span className="select-none text-cyan-300">$</span>
      <code className="flex-1 text-zinc-100">{code}</code>
      <span className="text-xs text-zinc-500"># {comment}</span>
    </div>
  );
}
