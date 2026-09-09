import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { GithubIcon } from "@/components/icons";
import { Bug, GitPullRequest, BookOpen, ShieldAlert, Star, MessagesSquare, ArrowRight } from "lucide-react";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Community" };

/** Real places where the XR community exists — the repository, and nowhere else. */
const places = [
  {
    icon: GithubIcon,
    title: "GitHub — the home",
    desc: "Source, issues, pull requests, releases and discussions all live in one public repository.",
    href: site.github,
    cta: "Open the repository",
  },
  {
    icon: Star,
    title: "Star & watch",
    desc: "Follow releases and signal what matters. Watching is how you stay current with a local-first project.",
    href: site.github,
    cta: "Star the repo",
  },
  {
    icon: Bug,
    title: "Issues",
    desc: "Report bugs with a reproduction, propose features, or ask how something works.",
    href: `${site.github}/issues`,
    cta: "Open an issue",
  },
  {
    icon: GitPullRequest,
    title: "Pull requests",
    desc: "The contribution guide covers the full path: conventions, ownership map and CI gates.",
    href: `${site.github}/blob/main/CONTRIBUTING.md`,
    cta: "Read CONTRIBUTING.md",
  },
  {
    icon: BookOpen,
    title: "Code of conduct",
    desc: "Contributor Covenant 2.1 — the project is a safe space for contributors at every level.",
    href: `${site.github}/blob/main/CODE_OF_CONDUCT.md`,
    cta: "Read the CoC",
  },
  {
    icon: ShieldAlert,
    title: "Security disclosure",
    desc: "Vulnerabilities go through GitHub Security Advisories — never an unverifiable email.",
    href: `${site.github}/security/advisories`,
    cta: "Report a vulnerability",
  },
];

export default function CommunityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Community"
        title="The repository is the community."
        subtitle="XR has no Discord server, no forum and no company Slack. Everything happens in the open, on GitHub, where it can be searched and referenced later."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {places.map((p) => (
              <a key={p.title} href={p.href} target="_blank" rel="noreferrer" className="card card-hover group block p-6">
                <div className="icon-tile h-11 w-11 rounded-xl">
                  <p.icon className="h-5 w-5 text-cyan-300" />
                </div>
                <h3 className="mt-5 font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{p.desc}</p>
                <div className="mt-5 inline-flex items-center gap-1 text-sm text-zinc-300 transition-colors group-hover:text-cyan-300">
                  {p.cta} <ArrowRight className="arrow-nudge h-3.5 w-3.5" />
                </div>
              </a>
            ))}
          </div>

          <div className="card card-hover mx-auto mt-12 max-w-3xl p-8 text-center">
            <MessagesSquare className="mx-auto h-7 w-7 text-violet-400" />
            <h2 className="mt-3 text-xl font-semibold text-white">New here?</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Start with <code className="font-mono text-cyan-300">good-first-issue</code> labeled
              issues and the developer guide in <code className="font-mono">docs/development/</code>.
              All experience levels are welcome — the CI gates do the heavy lifting.
            </p>
            <a
              href={`${site.github}/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22`}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary mt-6"
            >
              Find a good first issue <ArrowRight className="arrow-nudge h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
