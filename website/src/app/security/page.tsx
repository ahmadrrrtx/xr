import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ShieldCheck, Lock, Key, FileCheck, Eye, Server, ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Security" };

const items = [
  { icon: ShieldCheck, title: "Capability-based security", desc: "Each skill receives only the capabilities it explicitly requests — file paths, network domains, and environment variables." },
  { icon: Lock, title: "Sandboxed execution", desc: "Skills run in hardened micro-sandboxes with syscall filtering, filesystem namespaces, and restricted network egress." },
  { icon: Key, title: "Secrets & key management", desc: "Encrypted vault with per-skill scoping, rotating credentials, and just-in-time approval for sensitive access." },
  { icon: Eye, title: "Human-in-the-loop", desc: "Confirm dangerous actions before they execute. Configure policies by skill, repository, and risk level." },
  { icon: FileCheck, title: "Signed packages", desc: "Every skill is signed by its author. The runtime verifies signatures before execution." },
  { icon: Server, title: "Audit & replay", desc: "Every run produces an immutable audit log. Replay sessions end-to-end for debugging and compliance." },
];

const certifications = ["SOC 2 Type II", "ISO 27001", "HIPAA-ready", "GDPR", "CCPA"];

export default function SecurityPage() {
  return (
    <>
      <PageHeader
        eyebrow="Security"
        title="Security is the product."
        subtitle="XR was designed with a security core, not security bolted on. Capabilities, sandboxing, and audit are fundamental primitives."
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
                {certifications.map((c) => (
                  <span key={c} className="px-3 py-1.5 rounded-full border border-white/10 text-sm text-zinc-300 bg-white/[0.03]">
                    {c}
                  </span>
                ))}
              </div>
              <h2 className="mt-8 text-3xl md:text-4xl font-semibold tracking-tight text-gradient">
                Request our security dossier.
              </h2>
              <p className="mt-4 text-zinc-400 max-w-xl mx-auto">
                Including our SOC 2 report, penetration test summaries, and architecture whitepaper.
              </p>
              <Link href="/contact" className="btn btn-primary mt-8">
                Request dossier <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
