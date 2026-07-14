import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { research } from "@/lib/data";
import { FileText, ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Research" };

export default function ResearchPage() {
  return (
    <>
      <PageHeader
        eyebrow="Research"
        title="Pushing agentic systems forward."
        subtitle="XR Research publishes open work on agent architectures, tool use, inference, and security — to move the field forward for everyone."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6 space-y-4">
          {research.map((r) => (
            <a key={r.title} href="#" className="card p-6 flex items-start gap-4 group">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-sky-500/20 to-violet-500/10 border border-white/10 shrink-0">
                <FileText className="h-5 w-5 text-sky-300" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="px-1.5 py-0.5 rounded bg-white/5 border border-white/5">{r.tag}</span>
                  <span>{r.year}</span>
                </div>
                <h3 className="mt-1.5 text-white font-semibold group-hover:text-violet-200 transition-colors">
                  {r.title}
                </h3>
                <p className="text-sm text-zinc-500 mt-1">{r.authors}</p>
              </div>
              <ExternalLink className="h-4 w-4 text-zinc-500 group-hover:text-white transition-colors" />
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
