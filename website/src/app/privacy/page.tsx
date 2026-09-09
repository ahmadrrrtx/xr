import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { ShieldCheck, Database, FileCode2 } from "lucide-react";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy" subtitle="Short version: there is nothing to collect." />
      <section className="pb-24">
        <article className="mx-auto max-w-3xl space-y-5 px-6 leading-relaxed text-zinc-300">
          <div className="card card-hover flex items-start gap-4 p-6">
            <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
            <p className="text-sm">
              XR is self-hosted, MIT-licensed software. <b className="text-white">This website sets no
              cookies, runs no analytics and collects no personal information.</b> The product you
              download has zero telemetry endpoints — the only network calls it makes are to model
              providers you configured yourself.
            </p>
          </div>
          <h2 className="pt-4 text-xl font-semibold text-white">Your data</h2>
          <p>
            Your prompts, sessions, memory, skills and audit log live in one SQLite database on
            your machine, under your state directory. Nothing is uploaded, synchronized or
            shared. You can export everything (<code className="font-mono text-cyan-300">xr context export</code>) or
            delete it (<code className="font-mono text-cyan-300">xr context prune</code>).
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">API keys</h2>
          <p>
            Provider keys are read from your environment and never logged. The audit log records
            <em> that</em> a call was made, not the key or the content of the request.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">Model providers</h2>
          <p>
            If you connect a hosted provider (OpenAI, Anthropic, Gemini…), your prompts travel to
            that provider under <em>their</em> privacy policy — that is what BYOK means. To avoid
            third parties entirely, run one of the 10 local runtimes; XR works fully offline.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">This website</h2>
          <p>
            The status page fetches public data from the npm registry and the GitHub API. No
            visitor data is stored anywhere by XR.
          </p>
          <div className="flex items-start gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-5 text-sm">
            <FileCode2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            <p className="text-zinc-400">
              Verify every claim above: the code is public at{" "}
              <a className="text-cyan-300 hover:underline" href={site.github} target="_blank" rel="noreferrer">
                github.com/ahmadrrrtx/xr
              </a>
              , and the docs describe the data model in detail.
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
