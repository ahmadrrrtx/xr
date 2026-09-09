import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { BookOpen, Bug, ShieldAlert, Terminal as Term, ArrowRight } from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Support" };

const channels = [
  {
    icon: BookOpen,
    title: "Documentation",
    desc: "Every guide and reference ships in the repository with the code — start at the docs hub.",
    cta: "Open documentation",
    href: "/docs",
  },
  {
    icon: Term,
    title: "In-product help",
    desc: "Every surface carries its own help: `xr help`, `xr help <topic>`, and the Control Center panels.",
    cta: "See the CLI reference",
    href: `${site.github}/blob/main/docs/cli/README.md`,
    external: true,
  },
  {
    icon: GithubIcon,
    title: "GitHub Issues",
    desc: "Bugs, questions and feature requests — in the open, where answers are searchable forever.",
    cta: "Open an issue",
    href: `${site.github}/issues`,
    external: true,
  },
  {
    icon: Bug,
    title: "Before you open an issue",
    desc: "Include `xr doctor` output and a minimal reproduction. Good issues get fixed fast.",
    cta: "Read the contributing guide",
    href: `${site.github}/blob/main/CONTRIBUTING.md`,
    external: true,
  },
  {
    icon: ShieldAlert,
    title: "Security reports",
    desc: "Found a vulnerability? Report it through GitHub Security Advisories — never in a public issue.",
    cta: "Disclosure process",
    href: `${site.github}/security/advisories`,
    external: true,
  },
];

export default function SupportPage() {
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Help that stays verifiable."
        subtitle="XR is an open-source project: support happens where everyone can read it — the repository. No ticket system, no priority queue, no email black hole."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid gap-5 md:grid-cols-2">
            {channels.map((c) => (
              <a
                key={c.title}
                href={c.href}
                {...(c.external ? { target: "_blank", rel: "noreferrer" } : {})}
                className="card card-hover group flex items-start gap-4 p-6"
              >
                <div className="icon-tile h-11 w-11 shrink-0 rounded-xl">
                  <c.icon className="h-5 w-5 text-cyan-300" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-white">{c.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-400">{c.desc}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-sm text-zinc-300 transition-colors group-hover:text-cyan-300">
                    {c.cta} <ArrowRight className="arrow-nudge h-3.5 w-3.5" />
                  </div>
                </div>
              </a>
            ))}
          </div>
          <div className="card card-hover mt-10 p-7 text-center">
            <p className="text-sm leading-relaxed text-zinc-400">
              Need something answered privately? Run <code className="font-mono text-cyan-300">xr doctor</code>{" "}
              first — most questions answer themselves once the diagnostics are in front of you.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
