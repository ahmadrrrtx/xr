"use client";

import { PageHeader } from "@/components/PageHeader";
import { site } from "@/lib/site";
import { Mail, MapPin, MessageCircle } from "lucide-react";

export default function ContactPage() {
  return (
    <>
      <PageHeader eyebrow="Contact" title="Get in touch." subtitle="XR is an open-source project. Everything happens in the repository." />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6 grid md:grid-cols-3 gap-5">
          <ContactCard icon={MessageCircle} title="Questions & bugs" lines={["GitHub Issues", "The fastest way to reach the project"]} href={`${site.github}/issues`} />
          <ContactCard icon={Mail} title="Security disclosure" lines={["SECURITY.md", "Coordinated disclosure process"]} href={`${site.github}/blob/main/SECURITY.md`} />
          <ContactCard icon={MapPin} title="Source" lines={["ahmadrrrtx/xr", "MIT licensed — read everything"]} href={site.github} />
        </div>
        <div className="mx-auto max-w-2xl px-6 mt-12 card p-8 text-center">
          <h2 className="text-xl font-semibold text-white">No contact form</h2>
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
            A form that silently discards your message is worse than no form. XR is developed in the
            open, so every conversation happens where you can see it and reference it later.
          </p>
          <a href={`${site.github}/issues/new`} target="_blank" rel="noreferrer" className="btn btn-primary mt-6">
            Open an issue on GitHub
          </a>
        </div>
      </section>
    </>
  );
}

function ContactCard({ icon: Icon, title, lines, href }: { icon: React.ComponentType<{ className?: string }>; title: string; lines: string[]; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="card p-6 block hover:bg-white/[0.03] transition-colors">
      <Icon className="h-5 w-5 text-violet-300" />
      <div className="mt-3 text-white font-semibold">{title}</div>
      {lines.map((l) => <div key={l} className="text-sm text-zinc-400 mt-1">{l}</div>)}
    </a>
  );
}

