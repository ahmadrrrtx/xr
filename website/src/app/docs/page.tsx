import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { site } from "@/lib/site";
import {
  BookOpen,
  Code2,
  Cpu,
  Package,
  ShieldCheck,
  Terminal as Term,
  Workflow,
  ArrowRight,
  Mic,
  Boxes,
  Server,
  BookText,
} from "lucide-react";

export const metadata: Metadata = { title: "Documentation" };

/**
 * Documentation hub — every card opens a REAL document inside the repository
 * (docs/). Documentation lives with the code, so it can never drift silently.
 */
const sections = [
  {
    icon: BookOpen,
    title: "Getting started",
    desc: "Install XR, connect a model, and run your first task.",
    path: "docs/development/GETTING_STARTED.md",
  },
  {
    icon: Term,
    title: "CLI reference",
    desc: "Every command, flag and example — generated from the real catalog.",
    path: "docs/cli/README.md",
  },
  {
    icon: BookText,
    title: "User guide",
    desc: "Surfaces, environments, recovery and reversibility.",
    path: "docs/environment/USER_GUIDE.md",
  },
  {
    icon: Boxes,
    title: "Skills & marketplace",
    desc: "Author, test and publish manifest-declared skills.",
    path: "docs/SKILLS-MARKETPLACE.md",
  },
  {
    icon: Package,
    title: "Plugins",
    desc: "Extend XR with commands and tools behind declared permissions.",
    path: "docs/PLUGINS.md",
  },
  {
    icon: Workflow,
    title: "MCP & capabilities",
    desc: "Capability API across skills, plugins, MCP and tools.",
    path: "docs/CAPABILITIES.md",
  },
  {
    icon: Cpu,
    title: "Providers & models",
    desc: "The provider gateway: presets, routing and fallbacks.",
    path: "docs/implementation/PHASE_04_PROVIDER_GATEWAY.md",
  },
  {
    icon: ShieldCheck,
    title: "Security model",
    desc: "Threat model, policy gate, approvals and the audit chain.",
    path: "SECURITY.md",
  },
  {
    icon: Server,
    title: "Deployment & operations",
    desc: "Self-host, automate and operate XR in production.",
    path: "docs/research/OPERATIONS.md",
  },
  {
    icon: Mic,
    title: "Voice",
    desc: "Opt-in STT/TTS: setup, states and privacy notes.",
    path: "docs/environment/VOICE.md",
  },
];

export default function DocsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Docs"
        title="Documentation lives with the code."
        subtitle="The source of truth is the repository's docs/ directory — versioned, reviewed and CI-checked against the implementation. Every card below opens the real document."
      />
      <section className="pb-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="code-line mx-auto mb-10 max-w-xl justify-center !gap-2 !rounded-full !py-2.5 text-center">
            <span className="select-none text-cyan-300">λ</span>
            <code className="text-zinc-200">xr help topics</code>
            <span className="text-zinc-500">— every topic, in your terminal</span>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              <a
                key={s.title}
                href={`${site.github}/blob/main/${s.path}`}
                target="_blank"
                rel="noreferrer"
                className="card card-hover group block p-6"
              >
                <div className="flex items-start justify-between">
                  <div className="icon-tile h-11 w-11 rounded-xl">
                    <s.icon className="h-5 w-5 text-cyan-300" />
                  </div>
                  <ArrowRight className="arrow-nudge h-4 w-4 text-zinc-600" />
                </div>
                <h3 className="mt-5 flex items-center gap-1.5 font-semibold text-white">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.desc}</p>
                <div className="mt-4 truncate font-mono text-[11px] text-zinc-600">{s.path}</div>
              </a>
            ))}
          </div>
          <div className="mt-12 text-center text-sm text-zinc-500">
            Can't find something?{" "}
            <a
              href={`${site.github}/issues/new`}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300 hover:underline"
            >
              Open an issue
            </a>{" "}
            — the docs are a public good.
          </div>
        </div>
      </section>
    </>
  );
}
