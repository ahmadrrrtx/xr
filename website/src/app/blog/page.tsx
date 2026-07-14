import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { posts } from "@/lib/data";
import { ArrowRight, Calendar, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Blog" };

export default function BlogPage() {
  const [featured, ...rest] = posts;
  return (
    <>
      <PageHeader
        eyebrow="Blog"
        title="News, essays, and engineering."
        subtitle="Product updates, deep engineering posts, and essays on the future of agentic software."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <Link href={`/blog/${featured.slug}`} className="card p-8 md:p-12 block group relative overflow-hidden">
            <div aria-hidden className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(600px 240px at 0% 0%, rgba(124,92,255,0.2), transparent 70%)" }} />
            <div className="relative">
              <span className="text-[10px] uppercase tracking-wider text-violet-300 bg-violet-500/15 border border-violet-400/20 rounded-full px-2 py-0.5">Featured · {featured.tag}</span>
              <h2 className="mt-4 text-2xl md:text-4xl font-semibold tracking-tight text-gradient">{featured.title}</h2>
              <p className="mt-3 text-zinc-400 max-w-2xl">{featured.excerpt}</p>
              <div className="mt-5 flex items-center gap-4 text-xs text-zinc-500">
                <span>{featured.author}</span>
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {featured.date}</span>
                <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {featured.readTime}</span>
              </div>
            </div>
          </Link>

          <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {rest.map((p) => (
              <Link key={p.slug} href={`/blog/${p.slug}`} className="card p-6 flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-zinc-400 bg-white/5 border border-white/10 rounded-full px-2 py-0.5 self-start">{p.tag}</span>
                <h3 className="mt-4 text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed flex-1">{p.excerpt}</p>
                <div className="mt-5 pt-4 border-t border-white/5 flex items-center gap-4 text-xs text-zinc-500">
                  <span>{p.author}</span>
                  <span className="ml-auto flex items-center gap-1 text-zinc-400 group-hover:text-white">
                    Read <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
