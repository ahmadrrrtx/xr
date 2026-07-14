import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <>
      <PageHeader
        eyebrow="About"
        title="Building the future of software creation."
        subtitle="XR was founded on a simple belief: software should be a collaboration between human intent and machine capability. We&rsquo;re building the runtime that makes that real."
      />
      <section className="pb-16">
        <div className="mx-auto max-w-3xl px-6 space-y-6 text-zinc-300 leading-relaxed">
          <p>
            Today&rsquo;s tools for building software still assume the human does all the typing, all the searching, all the coordination.
            That&rsquo;s changing. XR is the runtime that lets agents plan, execute, and iterate alongside humans &mdash; safely, reproducibly,
            and at the speed of thought.
          </p>
          <p>
            We&rsquo;re a team of engineers and designers from Apple, Vercel, Anthropic, and Stripe. We care deeply about craft, performance,
            and the small details that make a tool feel inevitable.
          </p>
          <h2 className="text-2xl font-semibold text-white pt-6">Our principles</h2>
          <ul className="space-y-3">
            <li><b className="text-white">Local-first.</b> Your data lives on your machine. The cloud is optional.</li>
            <li><b className="text-white">Composable.</b> Small, typed primitives combine into powerful workflows.</li>
            <li><b className="text-white">Secure.</b> Capabilities are explicit. Nothing runs without your say-so.</li>
            <li><b className="text-white">Open.</b> The runtime is open. Ecosystems thrive on standards.</li>
          </ul>
          <h2 className="text-2xl font-semibold text-white pt-6">Press</h2>
          <p>For press inquiries, email <a className="text-violet-300 hover:underline" href="mailto:press@xr.dev">press@xr.dev</a>.</p>
          <Link href="/careers" className="btn btn-primary mt-4 inline-flex">
            Join our team <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </>
  );
}
