import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { MessageCircle, Calendar, Users, BookOpen, ArrowRight } from "lucide-react";
import { GithubIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Community" };

const places = [
  { icon: MessageCircle, title: "Discord", desc: "Chat with the core team and 80,000+ developers.", href: "#", cta: "Join Discord" },
  { icon: GithubIcon, title: "GitHub Discussions", desc: "Propose features, report bugs, and share what you're building.", href: "#", cta: "Start a discussion" },
  { icon: Calendar, title: "Events", desc: "Weekly office hours, monthly meetups, and an annual conference.", href: "#", cta: "See schedule" },
  { icon: Users, title: "Contributors", desc: "XR is open source. We welcome contributors of all experience levels.", href: "#", cta: "Contribute" },
  { icon: BookOpen, title: "Showcase", desc: "See what the community is building with XR.", href: "#", cta: "Explore showcase" },
];

export default function CommunityPage() {
  return (
    <>
      <PageHeader eyebrow="Community" title="Built with the community." subtitle="Join 800k+ developers building the future of agentic software together." />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {places.map((p) => (
            <Link key={p.title} href={p.href} className="card p-6 group">
              <p.icon className="h-6 w-6 text-violet-300" />
              <h3 className="mt-4 text-white font-semibold">{p.title}</h3>
              <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{p.desc}</p>
              <div className="mt-5 inline-flex items-center gap-1 text-sm text-zinc-300 group-hover:text-white">
                {p.cta} <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
