import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Status",
  description:
    "XR service status. Realtime monitoring arrives after launch; known outages live in the GitHub issue tracker.",
};

/**
 * `/status` (Phase 31 · Bucket B · B7). This page used to show invented
 * uptime percentages refreshed "every 60 seconds". There is no monitoring
 * pipeline behind it yet, so the page says exactly that instead of
 * performing reliability. When real monitoring lands after launch, this
 * page is where it reports — until then, the public issue tracker is the
 * honest status feed.
 */
export default function StatusPage() {
  return (
    <>
      <PageHeader
        eyebrow="Status"
        title="No live status feed yet."
        subtitle="Realtime uptime monitoring is coming after launch. Check the public issue tracker for known outages."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-3xl px-6 space-y-3">
          <div className="card p-6">
            <div className="text-white font-medium">Where to look today</div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Known outages, incidents, and workarounds are tracked in the open on GitHub. If something
              hosted is broken, an issue there will say so — and if it is not there, please file it.
            </p>
            <a
              href="https://github.com/ahmadrrrtx/xr/issues"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm text-violet-300 hover:underline"
            >
              github.com/ahmadrrrtx/xr/issues <ArrowUpRight className="h-4 w-4" />
            </a>
          </div>

          <div className="card p-6">
            <div className="text-white font-medium">If XR itself seems down</div>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              XR Personal runs entirely on your machine: there is no XR server in the loop to be down.
              If the app is misbehaving, the{" "}
              <Link href="/support" className="text-violet-300 hover:underline">
                support page
              </Link>{" "}
              and `xr doctor` are the fastest routes. Business hosted services will appear here with real
              measurements once monitoring is live — not before.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
