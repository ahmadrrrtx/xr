import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { models } from "@/lib/data";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Models" };

export default function ModelsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Models"
        title="Every model. One runtime."
        subtitle="XR is model-agnostic. Use frontier models, open-weight, or your own fine-tunes. Route by cost, latency, or capability."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {models.map((m) => (
              <div key={m.name} className={cn("card p-6 relative", m.featured && "border-violet-400/30")}>
                {m.featured && (
                  <span className="absolute top-4 right-4 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-violet-200 bg-violet-500/15 border border-violet-400/20 rounded-full px-2 py-0.5">
                    <Sparkles className="h-3 w-3" /> Recommended
                  </span>
                )}
                <div className="text-xs uppercase tracking-wider text-zinc-500">{m.provider}</div>
                <h3 className="mt-1 text-lg font-semibold text-white">{m.name}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{m.description}</p>
                <div className="mt-5 grid grid-cols-2 gap-2 text-xs">
                  <Chip label="Context" value={m.context} />
                  <Chip label="Speed" value={m.speed} />
                  <Chip label="Tag" value={m.tag} />
                  <Chip label="Available" value="All plans" />
                </div>
                <Link href="/docs/models" className="btn btn-ghost w-full mt-5">
                  Use this model <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-gradient">
            Bring your own model.
          </h2>
          <p className="mt-4 text-zinc-400">
            Self-host Ollama, vLLM, Llama.cpp, or any OpenAI-compatible endpoint. XR&rsquo;s model gateway
            handles routing, caching, and cost controls out of the box.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/docs/models" className="btn btn-primary">
              <Check className="h-4 w-4" /> Self-hosting guide
            </Link>
            <Link href="/enterprise" className="btn btn-ghost">Enterprise models</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-zinc-200 mt-0.5">{value}</div>
    </div>
  );
}
