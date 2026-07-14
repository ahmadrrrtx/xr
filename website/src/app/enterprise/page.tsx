"use client";

import { PageHeader } from "@/components/PageHeader";
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
  { icon: ShieldCheck, title: "Enterprise-grade security", desc: "SOC 2 Type II, ISO 27001, HIPAA readiness. End-to-end audit, RBAC, and data residency controls." },
  { icon: KeyRound, title: "SSO & identity", desc: "SAML, OIDC, SCIM, Okta, Azure AD, Google Workspace. Just-in-time provisioning." },
  { icon: Server, title: "Self-hosted runtime", desc: "Deploy XR inside your VPC, on-prem, or air-gapped. Full control of data and models." },
  { icon: Network, title: "Private model gateway", desc: "Bring your own models, route through private endpoints, and enforce corporate LLM policies." },
  { icon: BarChart3, title: "Observability & governance", desc: "Full audit logs, cost controls, DLP, and OpenTelemetry export to your SIEM." },
  { icon: Users, title: "Dedicated partnership", desc: "Solutions engineers, 24/7 support, custom skills, and a shared roadmap." },
];

const logos = ["Fortune 500 Fintech", "Global Healthcare", "Top-3 Cloud", "Aerospace & Defense", "Major Retailer", "Leading University"];

export default function EnterprisePage() {
  return (
    <>
      <PageHeader
        eyebrow="Enterprise"
        title="XR for the enterprise."
        subtitle="Deploy the agentic runtime across your organization with security, governance, and support built in."
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
            Trusted by regulated industries
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {logos.map((l) => (
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
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-gradient">Let&rsquo;s talk.</h2>
              <p className="mt-3 text-zinc-400 text-sm leading-relaxed">
                Tell us about your team and the problems you&rsquo;re solving. We&rsquo;ll set up a tailored demo and a deployment plan.
              </p>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
              }}
            >
              <Field label="Work email" type="email" placeholder="you@company.com" />
              <Field label="Company" placeholder="Acme Inc." />
              <Field label="Team size" as="select">
                <option>1–10</option><option>11–50</option><option>51–200</option><option>201–1000</option><option>1000+</option>
              </Field>
              <button className="btn btn-primary w-full">
                Contact sales <ArrowRight className="h-4 w-4" />
              </button>
              <p className="text-[11px] text-zinc-500">By submitting you agree to our privacy policy.</p>
            </form>
          </div>
        </div>
      </section>
    </>
  );
}

function Field({
  label, children, as = "input", type = "text", placeholder,
}: {
  label: string; children?: React.ReactNode; as?: "input" | "select"; type?: string; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      {as === "input" ? (
        <input
          type={type}
          placeholder={placeholder}
          className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-400/50 outline-none"
        />
      ) : (
        <select className="mt-1 w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/50">
          {children}
        </select>
      )}
    </label>
  );
}
