import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { site } from "@/lib/site";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Careers" };

export default function CareersPage() {
  return (
    <>
      <PageHeader eyebrow="Careers" title="Build the future of software with us." subtitle="XR is an open-source project, not a funded company. There is no payroll — but the work is real and the issue tracker is open." />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6">
          <h2 className="text-xl font-semibold text-white mb-5">Open roles</h2>
          <div className="card p-6">
            <p className="text-zinc-300 leading-relaxed">
              <strong className="text-white">No open roles right now — watch this space.</strong> XR is
              an open-source project, not a funded company, so there is no payroll and nothing here is a
              job advert. When that changes, real openings will be posted on this page with real
              descriptions.
            </p>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed">
              The work is still real: contributions, bug reports, and pull requests are welcome today,
              and the issue tracker is where they happen.
            </p>
            <a
              href={`${site.github}/issues`}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-300 hover:underline"
            >
              Browse open issues <ArrowRight className="h-4 w-4" />
            </a>
          </div>

          <div className="mt-16 card p-8 text-center">
          <h2 className="text-2xl font-semibold text-white">Don&rsquo;t see your role?</h2>
          <p className="mt-2 text-zinc-400">Tell us what you have been building with XR, or what you would like to fix.</p>
            <Link href="/contact" className="btn btn-primary mt-5">
              Get in touch <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
