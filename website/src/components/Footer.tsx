import Link from "next/link";
import { site } from "@/lib/site";
import { XrLogo } from "@/components/Logo";
import { GithubIcon, TwitterIcon } from "@/components/icons";

export function Footer() {
  return (
    <footer className="relative mt-32 border-t border-white/5">
      <div className="mx-auto max-w-7xl px-6 py-16">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-10">
          <div className="col-span-2">
            <XrLogo />
            <p className="mt-4 text-sm text-zinc-400 max-w-xs">
              The agentic runtime for software. Built for developers, designed for teams.
            </p>
            <div className="mt-5 flex items-center gap-3 text-zinc-400">
              <a
                href={site.github}
                target="_blank"
                rel="noreferrer"
                aria-label="GitHub"
                className="p-2 rounded-lg hover:text-white hover:bg-white/5 transition-colors"
              >
                <GithubIcon className="h-4 w-4" />
              </a>
              <a
                href="https://twitter.com/"
                target="_blank"
                rel="noreferrer"
                aria-label="Twitter / X"
                className="p-2 rounded-lg hover:text-white hover:bg-white/5 transition-colors"
              >
                <TwitterIcon className="h-4 w-4" />
              </a>
            </div>
            <div className="mt-6 text-xs text-zinc-500">
              © {new Date().getFullYear()} XR Labs, Inc. All rights reserved.
            </div>
          </div>

          <FooterCol title="Product" links={site.footer.product} />
          <FooterCol title="Resources" links={site.footer.resources} />
          <FooterCol title="Company" links={site.footer.company} />
          <FooterCol title="Legal" links={site.footer.legal} />
        </div>

        <div className="mt-14 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
            All systems normal
          </div>
          <div>
            <Link href="/status" className="hover:text-zinc-200 transition-colors">
              Status
            </Link>
            <span className="mx-2 text-zinc-700">•</span>
            <Link href="/changelog" className="hover:text-zinc-200 transition-colors">
              v{site.version}
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
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 mb-4">
        {title}
      </h4>
      <ul className="space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-zinc-400 hover:text-white transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
