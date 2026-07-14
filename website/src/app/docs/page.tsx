import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import {
  BookOpen,
  Code2,
  Cpu,
  Package,
  ShieldCheck,
  Rocket,
  Terminal as Term,
  Workflow,
  ArrowRight,
  BookText,
} from "lucide-react";

export const metadata: Metadata = { title: "Documentation" };

const sections = [
  { icon: BookOpen, title: "Getting started", desc: "Install XR, run your first agent, and take the tour.", href: "/docs/getting-started" },
  { icon: Term, title: "CLI reference", desc: "Every command, flag, and environment variable.", href: "/docs/cli" },
  { icon: Code2, title: "Writing skills", desc: "Build, test, and publish skills with the XR SDK.", href: "/docs/skills" },
  { icon: Package, title: "Extensions", desc: "Extend the dashboard, runtime, and editor surfaces.", href: "/docs/extensions" },
  { icon: Workflow, title: "MCP & tools", desc: "Use any MCP server. Build custom tools and adapters.", href: "/docs/mcp" },
  { icon: Cpu, title: "Models", desc: "Configure local, remote, and custom models. Routing rules.", href: "/docs/models" },
  { icon: ShieldCheck, title: "Security", desc: "Capabilities, policies, secrets, and audit.", href: "/docs/security" },
  { icon: Rocket, title: "Deployment", desc: "Self-host, VPC deploy, and operate XR at scale.", href: "/docs/deployment" },
  { icon: BookText, title: "API reference", desc: "TypeScript and REST APIs, typed clients, Webhooks.", href: "/docs/api" },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Docs"
        title="Everything you need to build with XR."
        subtitle="Guides, references, and tutorials for getting started, building skills, and operating XR at scale."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="glass rounded-2xl p-4 mb-8 flex flex-col md:flex-row items-stretch gap-3">
            <div className="flex-1 flex items-center gap-2 bg-black/30 border border-white/10 rounded-xl px-3">
              <span className="text-zinc-500 text-sm">Search docs…</span>
              <span className="ml-auto text-[11px] text-zinc-500 border border-white/10 rounded px-1.5 py-0.5 font-mono">⌘K</span>
            </div>
            <Link href="/docs/getting-started" className="btn btn-primary">
              Quickstart <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sections.map((s) => (
              <Link key={s.title} href={s.href} className="card p-6 hover:border-violet-400/30 transition-colors">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-sky-500/10 border border-white/10">
                  <s.icon className="h-5 w-5 text-violet-300" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white flex items-center gap-1">
                  {s.title} <ArrowRight className="h-4 w-4 text-zinc-500" />
                </h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{s.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
