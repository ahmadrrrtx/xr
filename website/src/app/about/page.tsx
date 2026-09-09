import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ArrowRight, Heart, ShieldCheck, Cpu, Puzzle } from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { XrMark } from "@/components/Logo";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="An agent runtime you can actually audit."
        subtitle="XR is an open-source project: a local-first, provider-neutral agent runtime with approvals, budgets and a tamper-evident audit log. No company, no cloud, no accounts."
      />
      <section className="pb-16">
        <div className="mx-auto max-w-3xl px-6 space-y-6 text-zinc-300 leading-relaxed">
          <p>
            Most agent tools are black boxes around a chat window: you type, it answers, and you
            trust it. XR starts from a different question — <em>what did it actually do, and who
            said it could?</em> — and builds the runtime around the answer.
          </p>
          <p>
            XR is maintained in the open by{" "}
            <a className="text-cyan-300 hover:underline" href={site.github} target="_blank" rel="noreferrer">
              Muhammad Ahmad (@ahmadrrrtx)
            </a>{" "}
            with contributions from the community. Everything — runtime, CLI, dashboard, skills,
            docs and this website — is MIT-licensed and readable end to end.
          </p>

          <div className="card card-hover mt-8 flex items-center gap-4 p-6">
            <div className="icon-tile h-12 w-12 shrink-0 rounded-xl">
              <XrMark size={28} />
            </div>
            <div>
              <div className="text-sm font-semibold text-white">The project in numbers — measured, not marketed</div>
              <p className="mt-1 text-sm text-zinc-400">
                {site.skillCount} bundled skills · {site.providerCount} provider presets · 3,191 tests
                across 240 files · one SQLite database · 0 telemetry endpoints.
              </p>
            </div>
          </div>

          <h2 className="pt-6 text-2xl font-semibold text-white">Principles</h2>
          <ul className="space-y-3">
            <li className="flex items-start gap-3">
              <Cpu className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <span><b className="text-white">Local-first.</b> Your data lives on your machine. The cloud is optional, never mandatory.</span>
            </li>
            <li className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <span><b className="text-white">Governed.</b> Authority is separate from intelligence: approvals, budgets and policy gate every consequential action.</span>
            </li>
            <li className="flex items-start gap-3">
              <Puzzle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <span><b className="text-white">Composable.</b> Skills, plugins, MCP servers and models compose through one typed envelope.</span>
            </li>
            <li className="flex items-start gap-3">
              <Heart className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <span><b className="text-white">Honest.</b> Claims in the README must be evidenceable; the build fails on overclaims.</span>
            </li>
          </ul>

          <h2 className="pt-6 text-2xl font-semibold text-white">Get involved</h2>
          <p>
            The best way to help is in the repository: try it, read the code, open issues, and
            send pull requests. There is no Discord server and no mailing list — the repo is the
            community, and everything happens where it can be referenced later.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/community" className="btn btn-primary">
              Contribute <ArrowRight className="arrow-nudge h-4 w-4" />
            </Link>
            <a href={site.github} target="_blank" rel="noreferrer" className="btn btn-ghost">
              <GithubIcon className="h-4 w-4" /> Repository
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
