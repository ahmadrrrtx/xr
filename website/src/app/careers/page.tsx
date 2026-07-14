import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ArrowRight, MapPin } from "lucide-react";

export const metadata: Metadata = { title: "Careers" };

const roles = [
  { title: "Senior Software Engineer, Runtime", team: "Runtime", location: "San Francisco / Remote" },
  { title: "Software Engineer, Skills Platform", team: "Platform", location: "Remote (NA/EU)" },
  { title: "Design Engineer", team: "Design", location: "San Francisco / Remote" },
  { title: "Product Designer", team: "Design", location: "San Francisco / Remote" },
  { title: "Security Engineer", team: "Security", location: "Remote" },
  { title: "Staff Research Scientist", team: "Research", location: "Remote" },
  { title: "Developer Advocate", team: "DX", location: "Remote (Global)" },
  { title: "Solutions Engineer", team: "Enterprise", location: "NYC / Remote" },
];

const benefits = [
  "Competitive salary & equity",
  "Unlimited PTO + 4 weeks minimum",
  "Remote-first, flexible hours",
  "Top-tier health, dental, vision",
  "Home office & hardware budget",
  "Annual learning & conference budget",
  "Parental leave",
  "Offsites twice a year",
];

export default function CareersPage() {
  return (
    <>
      <PageHeader eyebrow="Careers" title="Build the future of software with us." subtitle="We're a small, senior team building tools that millions of developers will use every day. If you care about craft, come help." />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-xl font-semibold text-white mb-5">Open roles</h2>
          <div className="card divide-y divide-white/5 overflow-hidden">
            {roles.map((r) => (
              <a key={r.title} href="#" className="flex items-center gap-4 px-6 py-4 hover:bg-white/[0.03] transition-colors">
                <div className="flex-1">
                  <div className="text-white font-medium">{r.title}</div>
                  <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-3">
                    <span>{r.team}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {r.location}</span>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-500" />
              </a>
            ))}
          </div>

          <h2 className="text-xl font-semibold text-white mt-16 mb-5">Benefits</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {benefits.map((b) => (
              <div key={b} className="card p-4 text-sm text-zinc-300 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" /> {b}
              </div>
            ))}
          </div>

          <div className="mt-16 card p-8 text-center">
          <h2 className="text-2xl font-semibold text-white">Don&rsquo;t see your role?</h2>
          <p className="mt-2 text-zinc-400">We&rsquo;re always interested in meeting exceptional people.</p>
            <Link href="/contact" className="btn btn-primary mt-5">
              Get in touch <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
