import { Metadata } from "next";
import Link from "next/link";
import { Apple, Binary, Code2, Terminal as Term, Check, ShieldCheck, WifiOff } from "lucide-react";

import { WindowsIcon } from "@/components/icons";
import { InstallCmd } from "@/components/InstallCmd";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download XR",
  description:
    "Download XR for macOS, Windows and Linux. Free forever, no account required, works offline with your own keys or a local model.",
};

const platforms = [
  { icon: Apple, label: "macOS", note: "Universal · Apple Silicon & Intel", href: "/downloads#macos" },
  { icon: WindowsIcon, label: "Windows", note: "Windows 10+ · WSL2 recommended", href: "/downloads#windows" },
  { icon: Binary, label: "Linux", note: "x86_64 & arm64 · .deb / .rpm / .tar.gz", href: "/downloads#linux" },
];

/**
 * `/download`.
 *
 * A Phase 30 alias for `/downloads`. Both URLs work: `/download` is the one the
 * pricing page and the marketing emails point at, and `/downloads` is the one
 * that has been in the footer and the sitemap since before this release. Moving a
 * public URL to tidy an internal naming scheme is a bad trade, so this page
 * forwards to the full downloads page rather than duplicating or replacing it.
 */
export default function DownloadPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-5xl px-6 pt-36 pb-24">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="h-14 w-14 orb" aria-hidden />
            <p className="mt-8 text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Download</p>
            <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-native-text">
              Take the whole thing.
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-native-text-muted">
              One binary, every feature. No account, no sign-in screen, no activation. If you never create a
              team, you never speak to a server we operate.
            </p>

            <div className="mt-8 flex flex-wrap gap-2.5">
              <Link href="/downloads" className="inline-flex h-10 items-center rounded-lg bg-native-cyan px-5 text-[13px] font-medium text-[#02222a] transition hover:bg-native-cyan-soft">
                All platforms and packages
              </Link>
              <Link
                href="/auth/signup?intent=business"
                className="inline-flex h-10 items-center rounded-lg border border-native-border-strong px-5 text-[13px] font-medium text-native-text transition hover:border-native-cyan/50 hover:text-native-cyan"
              >
                Start a Business trial instead
              </Link>
            </div>

            <div className="mt-9">
              <div className="text-[11px] uppercase tracking-wider text-native-text-dim">Or, one line</div>
              <div className="mt-3">
                <InstallCmd />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-native-border bg-native-bg-elevated/60 p-7">
            <h2 className="text-[13px] font-medium text-native-text">What you are getting</h2>
            <ul className="mt-5 space-y-3">
              {[
                "Every feature that exists in XR today",
                "Your own API keys, or a local model",
                "Local memory, workspaces, agents, skills, MCP",
                "Voice, CLI, desktop, editors, mobile PWA",
                "The desktop app, MIT-licensed source",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[12.5px] leading-snug text-native-text-muted">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-cyan" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-6 space-y-3 border-t border-native-border pt-5">
              <div className="flex items-start gap-2.5 text-[12px] leading-relaxed text-native-text-muted">
                <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-cyan/70" />
                Works with the network unplugged. Verify it yourself with{" "}
                <code className="console-mono text-[11px] text-native-text">ss -tup | grep xr</code>.
              </div>
              <div className="flex items-start gap-2.5 text-[12px] leading-relaxed text-native-text-muted">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-cyan/70" />
                No telemetry, no phone-home, no licence heartbeat — signed and verified offline.
              </div>
            </div>
          </div>
        </div>

        <section className="mt-20">
          <h2 className="text-xl font-semibold tracking-tight text-native-text">Platforms</h2>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-native-border bg-native-border md:grid-cols-3">
            {platforms.map((p) => (
              <Link key={p.label} href={p.href} className="group bg-native-bg-elevated p-6 transition hover:bg-native-bg-subtle">
                <p.icon className="h-5 w-5 text-native-cyan" />
                <div className="mt-4 text-[13px] font-medium text-native-text">{p.label}</div>
                <div className="mt-1 text-[11.5px] text-native-text-dim">{p.note}</div>
                <div className="console-mono mt-3 text-[11px] text-native-text-dim">
                  v{site.version} · {site.codename}
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <h2 className="text-xl font-semibold tracking-tight text-native-text">Editors and terminals</h2>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-native-text-muted">
            The extensions talk to your local XR runtime over the same socket the desktop app uses. They work
            signed out, and they work without a network connection.
          </p>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {[
              ["VS Code", Code2],
              ["Neovim", Term],
              ["JetBrains", Code2],
              ["Zed", Code2],
              ["Cursor", Code2],
            ].map(([label, Icon]) => {
              const I = Icon as typeof Code2;
              return (
                <Link
                  key={label as string}
                  href="/downloads#editors"
                  className="inline-flex items-center gap-2 rounded-lg border border-native-border bg-native-bg-elevated px-3.5 py-2 text-[12.5px] text-native-text-muted transition hover:border-native-cyan/40 hover:text-native-cyan"
                >
                  <I className="h-3.5 w-3.5" />
                  {label as string}
                </Link>
              );
            })}
          </div>
        </section>

        <p className="mt-16 text-[12.5px] text-native-text-dim">
          Prefer to browse the full page with checksums and package managers?{" "}
          <Link href="/downloads" className="text-native-cyan hover:underline">
            /downloads
          </Link>{" "}
          has it all.
        </p>
      </div>
    </div>
  );
}
