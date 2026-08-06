"use client";

import { PageHeader } from "@/components/PageHeader";
import { site } from "@/lib/site";
import {
  Building2,
  ShieldCheck,
  KeyRound,
  Server,
  BarChart3,
  Network,
  Users,
  ArrowRight,
} from "lucide-react";

const pillars = [
  { icon: ShieldCheck, title: "Governed execution", desc: "Deterministic policy gate, human approval on consequential actions, per-task spend ceilings, and a hash-chained audit log." },
  { icon: KeyRound, title: "Your keys, your models", desc: "BYOK across cloud providers, or run entirely on local models with no external calls." },
  { icon: Server, title: "Self-hosted by design", desc: "XR runs on your machine or your server. There is no XR cloud to depend on." },
  { icon: Network, title: "Private model gateway", desc: "Bring your own models, route through private endpoints, and enforce corporate LLM policies." },
  { icon: BarChart3, title: "Cost + audit visibility", desc: "Per-task cost accounting and a local audit trail you can verify with one command." },
  { icon: Users, title: "Open development", desc: "Public roadmap, public issue tracker, MIT licence. Fork it if you need to." },
];

// XR does not publish customer names it does not have. These are the deployment
// targets XR actually supports today.
const deploymentTargets = ["Linux", "macOS", "Windows", "Termux/Android", "Docker", "Air-gapped"];

export default function EnterprisePage() {
  return (
    <>
      <PageHeader
        eyebrow="Enterprise"
        title="XR for the enterprise."
        subtitle="XR is self-hosted and local-first. This page describes what it does today — not a roadmap, and not a certification."
      />

      <section className="pb-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {pillars.map((p) => (
              <div key={p.title} className="card p-6 group">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-sky-500/10 border border-white/10">
                  <p.icon className="h-5 w-5 text-violet-300" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 text-center mb-8">
          Supported deployment targets
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {deploymentTargets.map((l) => (
              <div key={l} className="card p-5 text-center text-zinc-400 text-sm">
                {l}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="grid md:grid-cols-2 gap-8 card p-8 md:p-12">
            <div>
              <Building2 className="h-6 w-6 text-violet-300" />
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-gradient">Deploy it yourself.</h2>
              <p className="mt-3 text-zinc-400 text-sm leading-relaxed">
                XR is self-hosted and open source. Read the deployment docs, run it, and open an
                issue if something does not work.
              </p>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-zinc-400 leading-relaxed">
                There is no sales team and no lead-capture form. XR is MIT-licensed software you can
                deploy today without talking to anyone.
              </p>
              <a href={site.github} target="_blank" rel="noreferrer" className="btn btn-primary w-full">
                Get XR on GitHub <ArrowRight className="h-4 w-4" />
              </a>
              <a href={`${site.github}/issues`} target="_blank" rel="noreferrer" className="btn btn-ghost w-full">
                Ask a deployment question
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

