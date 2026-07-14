import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { posts } from "@/lib/data";
import { ArrowLeft, Calendar, Clock } from "lucide-react";

export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> }
): Promise<Metadata> {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) return { title: "Post" };
  return { title: post.title, description: post.excerpt };
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = posts.find((p) => p.slug === slug);
  if (!post) return notFound();

  return (
    <article className="pt-36 pb-24">
      <div className="mx-auto max-w-3xl px-6">
        <Link href="/blog" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to blog
        </Link>
        <div className="mt-8 text-xs uppercase tracking-widest text-violet-300">{post.tag}</div>
        <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-gradient leading-[1.1]">
          {post.title}
        </h1>
        <div className="mt-4 flex items-center gap-4 text-sm text-zinc-500">
          <span>{post.author}</span>
          <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {post.date}</span>
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {post.readTime}</span>
        </div>
        <div className="mt-10 max-w-none text-zinc-300 leading-relaxed space-y-5">
          <p className="text-lg text-zinc-300">{post.excerpt}</p>
          <p>
            XR 3.1 G represents a culmination of lessons learned from millions of agent runs, thousands of
            developer feedback sessions, and deep investment in a coherent runtime architecture rather than
            a patchwork of wrappers.
          </p>
          <h2 className="text-2xl font-semibold text-white mt-10">What&rsquo;s new</h2>
          <p>
            We&rsquo;ve rewritten the core in Rust to drive cold starts below 10ms, redesigned the skill graph
            to make composition first-class, and shipped a model router that understands cost, latency,
            and capability tradeoffs.
          </p>
          <h2 className="text-2xl font-semibold text-white mt-10">What&rsquo;s next</h2>
          <p>
            Expect faster local models, richer multi-agent orchestration, and deeper editor integrations
            over the coming year. We&rsquo;re just getting started.
          </p>
        </div>
      </div>
    </article>
  );
}
