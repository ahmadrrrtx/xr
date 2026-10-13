import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Legal",
  description: "Privacy policy, terms of service, and the plain-language summary of both.",
};

/**
 * `/legal` — an index, because the two documents below it are long and nobody
 * should have to guess which one answers their question.
 *
 * `/privacy` and `/terms` already exist at the top level and are linked from the
 * footer, the sign-up form and several emails. They are not moved: a URL that has
 * been in a contract is a URL that keeps working. `/legal/*` is added as the
 * canonical home, and the older paths continue to resolve.
 */
export default function LegalIndexPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Legal</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          The documents, and what they actually say
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-native-text-muted">
          {site.name} is open-source software with a hosted service attached. Most of what these documents
          govern is the hosted part. Neither document uses a defined term that isn&rsquo;t explained, and neither
          one has a clause about us changing the terms whenever we feel like it.
        </p>

        <div className="mt-12 space-y-px overflow-hidden rounded-xl border border-native-border bg-native-border">
          {[
            {
              href: "/legal/privacy",
              title: "Privacy policy",
              blurb:
                "What the cloud service stores, why, for how long, and the list of things it never receives. Includes the four sub-processors and the retention windows.",
              also: "/privacy",
            },
            {
              href: "/legal/terms",
              title: "Terms of service",
              blurb:
                "What you may do with the hosted service, what we promise, what we do not, and how cancellation and refunds work. The licence for the local software is MIT and is not restated here.",
              also: "/terms",
            },
          ].map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="group flex items-start justify-between gap-6 bg-native-bg-elevated p-7 transition hover:bg-native-bg-subtle"
            >
              <div>
                <div className="text-[15px] font-medium text-native-text group-hover:text-native-cyan">
                  {doc.title}
                </div>
                <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-native-text-muted">{doc.blurb}</p>
                <p className="console-mono mt-3 text-[11px] text-native-text-dim">also at {doc.also}</p>
              </div>
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-native-text-dim transition group-hover:translate-x-0.5 group-hover:text-native-cyan" />
            </Link>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-native-border bg-native-bg-elevated/50 p-6">
          <h2 className="text-[13px] font-semibold text-native-text">The one-paragraph version</h2>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-native-text-muted">
            The software you download is yours under the MIT licence and we cannot take it back. The hosted
            service stores your account, your team and your billing records, and nothing about what you do in
            XR on your own machine. We do not sell data, we do not run analytics, and we do not use your
            content to train anything. If you stop paying, your local installation is unchanged and your team
            data stays exportable for 30 days.
          </p>
        </div>
      </div>
    </div>
  );
}
