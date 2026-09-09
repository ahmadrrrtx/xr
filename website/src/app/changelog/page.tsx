import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { changelog } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Changelog" };

export default function ChangelogPage() {
  const latest = changelog[0]!;
  return (
    <>
      <PageHeader
        eyebrow="Changelog"
        title="What's new in XR."
        subtitle="Compiled from the repository's CHANGELOG.md — the same file CI checks against the release manifest."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-3xl px-6">
          <div className="relative">
            <div className="absolute bottom-2 left-4 top-2 w-px bg-white/10" aria-hidden />
            <div className="space-y-10">
              {changelog.map((c, idx) => (
                <div key={c.version + c.date} className="relative pl-12">
                  <div
                    className={cn(
                      "absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border",
                      idx === 0
                        ? "border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_18px_-4px_rgba(0,212,255,0.6)]"
                        : "border-white/10 bg-white/[0.03]"
                    )}
                  >
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        idx === 0 ? "bg-cyan-300" : "bg-zinc-600"
                      )}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="font-semibold text-white">
                      {c.version === "main (next)" ? "main (in development)" : `v${c.version}`}
                    </div>
                    <div className="text-xs text-zinc-500">{c.date}</div>
                    {idx === 0 && (
                      <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-cyan-200">
                        {c.version === "main (next)" ? "Next release" : "Latest"}
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 text-xl text-white">{c.title}</h2>
                  <ul className="mt-4 space-y-2 text-sm text-zinc-400">
                    {c.highlights.map((h) => (
                      <li key={h} className="flex items-start gap-2.5">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400/80" />
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
