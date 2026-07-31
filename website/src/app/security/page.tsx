import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { site } from "@/lib/site";
import { ShieldCheck, Lock, Key, FileCheck, Eye, Server, ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Security" };

const items = [
  { icon: ShieldCheck, title: "Authority is not intelligence", desc: "A model proposes; policy, approval and budget grant. The gate runs even when the model is wrong or manipulated." },
  { icon: Lock, title: "Deterministic policy gate", desc: "Egress allow-listing, secret-path denial, and dangerous-command blocking are evaluated in-process before any tool runs — independent of what the model decided." },
  { icon: Key, title: "Secrets stay yours", desc: "BYOK: provider keys are read from your environment. The credential vault encrypts stored integration secrets with AES-256-GCM envelope encryption." },
  { icon: Eye, title: "Human-in-the-loop", desc: "Confirm dangerous actions before they execute. Configure policies by skill, repository, and risk level." },
  { icon: FileCheck, title: "Governed extensibility", desc: "Plugins declare permissions and are disabled by default. Nothing is loaded until you enable it." },
  { icon: Server, title: "Tamper-evident audit", desc: "Every consequential action is appended to a hash-chained local log. `xr audit verify` detects any modification." },
];

// XR holds no third-party certifications. Stating that plainly is the point:
// Constitution Article XIX forbids advertising certifications that do not exist.
const honestPosture = [
  "MIT licensed",
  "No telemetry",
  "Local-first",
  "BYOK",
  "Open source — audit it yourself",
];

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Security is the product."
        subtitle="XR separates authority from intelligence: a deterministic policy gate, human approval, spend ceilings, and a tamper-evident audit log."
      />
      <section className="pb-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {items.map((i) => (
              <div key={i.title} className="card p-6">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-emerald-500/20 to-sky-500/10 border border-white/10">
                  <i.icon className="h-5 w-5 text-emerald-300" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{i.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{i.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="card p-10 text-center relative overflow-hidden">
            <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(600px 300px at 50% 0%, rgba(16,185,129,0.18), transparent 70%)" }} />
            <div className="relative">
              <div className="flex flex-wrap justify-center gap-3">
                {honestPosture.map((c) => (
                  <span key={c} className="px-3 py-1.5 rounded-full border border-white/10 text-sm text-zinc-300 bg-white/[0.03]">
                    {c}
                  </span>
                ))}
              </div>
              <h2 className="mt-8 text-3xl md:text-4xl font-semibold tracking-tight text-gradient">
                Read the security model.
              </h2>
              <p className="mt-4 text-zinc-400 max-w-xl mx-auto">
                XR is not certified by any third party and does not claim to be. What it does have is
                a documented threat model, an in-process policy gate, and a hash-chained audit log —
                all of which you can read in the repository.
              </p>
              <p className="mt-3 text-sm text-zinc-500 max-w-xl mx-auto">
                XR enforces in-process policy, not kernel or VM isolation. Treat it as a strong guard
                rail, not a sandbox boundary.
              </p>
              <a href={`${site.github}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className="btn btn-primary mt-8">
                Read SECURITY.md <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
