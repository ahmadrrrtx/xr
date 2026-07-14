import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { BookOpen, MessageCircle, Mail, ArrowRight } from "lucide-react";
import { GithubIcon } from "@/components/icons";

export const metadata: Metadata = { title: "Support" };

const channels = [
  { icon: BookOpen, title: "Documentation", desc: "Guides, references, and tutorials for every XR feature.", cta: "Read docs", href: "/docs" },
  { icon: MessageCircle, title: "Community", desc: "Get help from the XR community and team on Discord and GitHub.", cta: "Join Discord", href: "/community" },
  { icon: GithubIcon, title: "GitHub Issues", desc: "Report bugs and request features in the open.", cta: "Open issue", href: "https://github.com/" },
  { icon: Mail, title: "Email support", desc: "Pro and Enterprise customers receive priority email support.", cta: "Contact us", href: "/contact" },
];

export default function SupportPage() {
  return (
    <>
      <PageHeader eyebrow="Support" title="We're here to help." subtitle="A variety of channels to get unstuck, from documentation to direct support." />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6 grid md:grid-cols-2 gap-5">
          {channels.map((c) => (
            <Link key={c.title} href={c.href} className="card p-7 group flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-sky-500/10 border border-white/10 shrink-0">
                <c.icon className="h-5 w-5 text-violet-300" />
              </div>
              <div className="flex-1">
                <h3 className="text-white font-semibold">{c.title}</h3>
                <p className="mt-1 text-sm text-zinc-400">{c.desc}</p>
                <div className="mt-3 inline-flex items-center gap-1 text-sm text-zinc-300 group-hover:text-white">
                  {c.cta} <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
