import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { changelog } from "@/lib/data";

export const metadata: Metadata = { title: "Changelog" };

export default function ChangelogPage() {
  return (
    <>
      <PageHeader eyebrow="Changelog" title="What&rsquo;s new in XR." subtitle="Release notes for every stable version." />
      <section className="pb-24">
        <div className="mx-auto max-w-3xl px-6 relative">
          <div className="absolute left-4 top-2 bottom-2 w-px bg-white/10" aria-hidden />
          <div className="space-y-10">
            {changelog.map((c, idx) => (
              <div key={c.version} className="relative pl-12">
                <div className="absolute left-0 top-1 h-8 w-8 rounded-full bg-violet-500/15 border border-violet-400/30 flex items-center justify-center">
                  <span className={`h-2 w-2 rounded-full ${idx === 0 ? "bg-violet-300" : "bg-zinc-500"}`} />
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-white font-semibold">v{c.version}</div>
                  <div className="text-xs text-zinc-500">{c.date}</div>
                  {idx === 0 && (
                    <span className="text-[10px] uppercase tracking-wider text-violet-200 bg-violet-500/15 border border-violet-400/20 rounded-full px-2 py-0.5">Latest</span>
                  )}
                </div>
                <h2 className="mt-1 text-xl text-white">{c.title}</h2>
                <ul className="mt-4 space-y-2 text-sm text-zinc-400">
                  {c.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
