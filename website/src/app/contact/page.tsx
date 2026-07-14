"use client";

import { PageHeader } from "@/components/PageHeader";
import { Mail, MapPin, MessageCircle } from "lucide-react";

export default function ContactPage() {
  return (
    <>
      <PageHeader eyebrow="Contact" title="Get in touch." subtitle="We'd love to hear from you. Reach the right team below." />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6 grid md:grid-cols-3 gap-5">
          <ContactCard icon={Mail} title="General" lines={["hello@xr.dev", "Response within 24h"]} />
          <ContactCard icon={MessageCircle} title="Sales" lines={["sales@xr.dev", "Enterprise demos"]} />
          <ContactCard icon={MapPin} title="HQ" lines={["San Francisco, CA", "Remote-first globally"]} />
        </div>
        <div className="mx-auto max-w-2xl px-6 mt-12 card p-8">
          <h2 className="text-xl font-semibold text-white">Send a message</h2>
          <form className="mt-6 grid gap-3" onSubmit={(e) => e.preventDefault()}>
            <Field label="Name" placeholder="Your name" />
            <Field label="Email" type="email" placeholder="you@company.com" />
            <Field label="Message" as="textarea" placeholder="How can we help?" />
            <button className="btn btn-primary w-full mt-2">Send message</button>
          </form>
        </div>
      </section>
    </>
  );
}

function ContactCard({ icon: Icon, title, lines }: { icon: React.ComponentType<{ className?: string }>; title: string; lines: string[] }) {
  return (
    <div className="card p-6">
      <Icon className="h-5 w-5 text-violet-300" />
      <div className="mt-3 text-white font-semibold">{title}</div>
      {lines.map((l) => <div key={l} className="text-sm text-zinc-400 mt-1">{l}</div>)}
    </div>
  );
}

function Field({ label, type = "text", placeholder, as = "input" }: { label: string; type?: string; placeholder?: string; as?: "input" | "textarea" }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      {as === "input" ? (
        <input type={type} placeholder={placeholder} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-400/50" />
      ) : (
        <textarea rows={4} placeholder={placeholder} className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-violet-400/50 resize-none" />
      )}
    </label>
  );
}
