import { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "XR documentation is in progress and lives in the GitHub repository for now: guides, the CLI reference, capabilities and the API docs.",
};

const sections = [
  { icon: BookOpen, title: "Getting started", desc: "Install XR, run your first agent, and take the tour.", href: "https://github.com/ahmadrrrtx/xr#readme" },
  { icon: Term, title: "CLI reference", desc: "Every command, flag, and environment variable.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/CAPABILITIES.md" },
  { icon: Code2, title: "Writing skills", desc: "Build, test, and publish skills with the XR SDK.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/SKILLS-MARKETPLACE.md" },
  { icon: Package, title: "Extensions", desc: "Extend the dashboard, runtime, and editor surfaces.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/PLUGINS.md" },
  { icon: Workflow, title: "MCP & tools", desc: "Use any MCP server. Build custom tools and adapters.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/CAPABILITIES.md" },
  { icon: Cpu, title: "Models", desc: "Configure local, remote, and custom models. Routing rules.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/CAPABILITIES.md" },
  { icon: ShieldCheck, title: "Security", desc: "Capabilities, policies, secrets, and audit.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/CONSTITUTION.md" },
  { icon: Rocket, title: "Deployment", desc: "Self-host and operate XR on your own infrastructure.", href: "https://github.com/ahmadrrrtx/xr/blob/main/docs/PRODUCTION_READINESS.md" },
  { icon: BookText, title: "API reference", desc: "TypeScript and REST APIs, typed clients, Webhooks.", href: "https://github.com/ahmadrrrtx/xr/tree/main/docs/api" },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Docs"
        title="Everything you need to build with XR."
        subtitle="Documentation is in progress — read the README on GitHub for now. The CLI also documents itself: run xr --help in your terminal."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="glass rounded-2xl p-4 mb-8 flex flex-col md:flex-row md:items-center gap-3">
            <p className="flex-1 px-2 text-sm leading-relaxed text-zinc-400">
              The full documentation site is being written. Until it lands, the guides below link to the
              living documents in the GitHub repository — the same files the project maintains.
            </p>
            <a href="https://github.com/ahmadrrrtx/xr#readme" target="_blank" rel="noreferrer" className="btn btn-primary">
              Quickstart <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {sections.map((s) => (
              <a key={s.title} href={s.href} target="_blank" rel="noreferrer" className="card p-6 hover:border-violet-400/30 transition-colors">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-sky-500/10 border border-white/10">
                  <s.icon className="h-5 w-5 text-violet-300" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white flex items-center gap-1">
                  {s.title} <ArrowRight className="h-4 w-4 text-zinc-500" />
                </h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{s.desc}</p>
              </a>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
