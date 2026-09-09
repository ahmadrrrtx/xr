import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { hostedProviders, localRuntimes } from "@/lib/data";
import { site } from "@/lib/site";
import { ArrowRight, KeyRound, Server, Cpu } from "lucide-react";

export const metadata: Metadata = {
  title: "Models & providers — bring your own, or run local",
  description:
    "XR ships 26 provider presets — 10 local runtimes (Ollama, llama.cpp, vLLM…) and 16 hosted APIs (OpenAI, Anthropic, Gemini, Groq…). BYOK, no keys leave your machine.",
};

export default function ModelsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Models & providers"
        title="Your models. One governed runtime."
        subtitle="XR ships no model and no API key — it ships presets. Connect a local runtime that runs on your hardware, or bring your own key for a hosted provider. Both live behind the same approval, budget and audit gate."
      />
      <section className="pb-10">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card card-hover flex items-start gap-4 p-6">
              <div className="icon-tile h-11 w-11 shrink-0 rounded-xl">
                <Server className="h-5 w-5 text-emerald-300" />
              </div>
              <div>
                <h3 className="font-semibold text-white">10 local runtimes — fully offline</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  Ollama, LM Studio, Jan, LocalAI, vLLM, llama.cpp, GPT4All, KoboldCpp,
                  text-generation-webui and SGLang. Zero cost, no network, no keys.
                </p>
              </div>
            </div>
            <div className="card card-hover flex items-start gap-4 p-6">
              <div className="icon-tile h-11 w-11 shrink-0 rounded-xl">
                <KeyRound className="h-5 w-5 text-cyan-300" />
              </div>
              <div>
                <h3 className="font-semibold text-white">16 hosted providers — BYOK</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  Keys are read from your environment, never logged, and model choice is a
                  one-line switch: <code className="font-mono text-[13px] text-cyan-300">xr providers set openai gpt-4o-mini</code>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-8">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <Cpu className="h-5 w-5 text-emerald-400" /> Local runtimes
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {localRuntimes.map((m) => (
              <div key={m.id} className="card card-hover p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white">{m.label}</h3>
                  <span className="shrink-0 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                    Local
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">auth: {m.auth}</p>
                <div className="mt-3 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11.5px] text-zinc-300">
                  {m.defaultModel}
                </div>
                <div className="mt-4 font-mono text-[11px] text-zinc-500">
                  xr providers set {m.id} …
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-12">
        <div className="mx-auto max-w-7xl px-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <KeyRound className="h-5 w-5 text-cyan-400" /> Hosted providers (BYOK)
          </h2>
          <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hostedProviders.map((m) => (
              <div key={m.id} className="card card-hover p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white">{m.label}</h3>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400">
                    BYOK
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{m.auth}</p>
                <div className="mt-3 rounded-lg border border-white/6 bg-white/[0.02] px-2.5 py-1.5 font-mono text-[11.5px] text-zinc-300">
                  {m.defaultModel}
                </div>
                <a
                  href={m.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-cyan-300"
                >
                  {m.docs.replace("https://", "")}
                  <ArrowRight className="arrow-nudge h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <h2 className="text-3xl font-semibold tracking-tight text-gradient md:text-5xl">
            Route by cost, latency or policy — explainably.
          </h2>
          <p className="mt-4 text-zinc-400">
            XR explains why a model was chosen, keeps sensitive work from silently routing to the
            cloud, and falls back gracefully when a provider is unavailable. Switch models
            anytime: <code className="font-mono text-cyan-300">xr models recommend</code> picks the
            best fit for your machine.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/docs" className="btn btn-primary">
              Provider docs <ArrowRight className="arrow-nudge h-4 w-4" />
            </Link>
            <a href={`${site.github}/blob/main/src/providers/presets.ts`} target="_blank" rel="noreferrer" className="btn btn-ghost">
              Read presets.ts on GitHub
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
