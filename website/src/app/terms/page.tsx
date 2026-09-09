import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { FileCode2 } from "lucide-react";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms" subtitle="Short version: it is MIT-licensed software. That is the whole deal." />
      <section className="pb-24">
        <article className="mx-auto max-w-3xl space-y-5 px-6 leading-relaxed text-zinc-300">
          <p>
            XR is open-source software released under the{" "}
            <a className="text-cyan-300 hover:underline" href={`${site.github}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
              MIT License
            </a>
            . These terms describe what that means for you — they are not a service agreement,
            because there is no service.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">No accounts, no services</h2>
          <p>
            XR does not operate accounts, subscriptions, hosted services or cloud infrastructure.
            You download or build the software and run it yourself. Nothing on this website or in
            the product is gated behind a paid plan.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">License</h2>
          <p>
            The MIT License grants you permission to use, copy, modify, merge, publish,
            distribute, sublicense and sell copies of the software, subject to its conditions.
            Your prompts, sessions and any work you create with XR belong to you.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">Acceptable use</h2>
          <p>
            The repository's policy and security model are documented in{" "}
            <a className="text-cyan-300 hover:underline" href={`${site.github}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
              SECURITY.md
            </a>
            . You are responsible for what you ask agents to do on machines you control, for the
            consequences of approving their actions, and for complying with applicable law.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">Warranty &amp; liability</h2>
          <p>
            The software is provided &ldquo;as is&rdquo;, without warranty of any kind. AI output
            can be incorrect; review consequential actions before approving them. To the extent
            permitted by law, the authors are not liable for damages arising from use of the
            software.
          </p>
          <h2 className="pt-4 text-xl font-semibold text-white">Trademarks</h2>
          <p>
            The XR name and logo are used to identify the project. This website is not affiliated
            with any other project named XR. The project holds no registered trademarks.
          </p>
          <div className="flex items-start gap-4 rounded-xl border border-white/8 bg-white/[0.02] p-5 text-sm">
            <FileCode2 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />
            <p className="text-zinc-400">
              Questions about these terms? Open an issue at{" "}
              <a className="text-cyan-300 hover:underline" href={site.github} target="_blank" rel="noreferrer">
                github.com/ahmadrrrtx/xr
              </a>
              .
            </p>
          </div>
        </article>
      </section>
    </>
  );
}
