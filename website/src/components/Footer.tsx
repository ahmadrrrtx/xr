import Link from "next/link";
import { site } from "@/lib/site";
import { XrLogo } from "@/components/Logo";
import { GithubIcon } from "@/components/icons";

export function Footer() {
  return (
    <footer className="relative mt-32 border-t border-white/5">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <XrLogo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-400">
              An AI agent runtime you can actually audit. Local-first, MIT-licensed, provider-neutral.
            </p>
            <div className="mt-5 flex items-center gap-2 text-zinc-400">
              <a
                href={site.github}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className="rounded-lg p-2 transition-all hover:bg-white/5 hover:text-white hover:shadow-[0_0_16px_-4px_rgba(0,212,255,0.4)]"
              >
                <GithubIcon className="h-4 w-4" />
              </a>
              <a
                href="https://github.com/ahmadrrrtx/xr"
                target="_blank"
                rel="noreferrer"
                aria-label="Repository"
                className="rounded-lg px-2 py-1.5 font-mono text-[11px] text-zinc-500 transition-all hover:bg-white/5 hover:text-cyan-300"
              >
                github.com/ahmadrrrtx/xr
              </a>
            </div>
            <div className="mt-6 text-xs leading-relaxed text-zinc-500">
              © {new Date().getFullYear()} Muhammad Ahmad & XR contributors.
              <br />
              MIT License · no company, no cloud, no telemetry.
            </div>
          </div>

          <FooterCol title="Product" links={site.footer.product} />
          <FooterCol title="Resources" links={site.footer.resources} />
          <FooterCol title="Project" links={site.footer.company} />
          <FooterCol title="Legal" links={site.footer.legal} />
        </div>

        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-white/5 pt-8 text-xs text-zinc-500 md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
            Self-hosted software — the only status that matters is yours (xr doctor)
          </div>
          <div className="flex items-center gap-3">
            <Link href="/status" className="transition-colors hover:text-zinc-200">
              Status
            </Link>
            <span className="text-zinc-700">•</span>
            <Link href="/changelog" className="transition-colors hover:text-zinc-200">
              v{site.version} ({site.codename})
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: readonly { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-zinc-300">{title}</h4>
      <ul className="space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.href + l.label}>
            {l.href.startsWith("http") ? (
              <a
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="text-zinc-400 transition-colors hover:text-cyan-300"
              >
                {l.label}
              </a>
            ) : (
              <Link href={l.href} className="text-zinc-400 transition-colors hover:text-cyan-300">
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
