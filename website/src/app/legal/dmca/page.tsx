import { Metadata } from "next";

export const metadata: Metadata = {
  title: "DMCA policy",
  description: "How to send a copyright takedown notice or a counter-notice for XR's hosted service.",
};

/**
 * `/legal/dmca` (Phase 31 · Bucket B · B11). The local XR software stores
 * nothing of yours on our servers, so this process exists for the hosted
 * Business service only. The designated agent name is a launch placeholder:
 * registration with the US Copyright Office is a launch checklist item, and
 * until it lands the page says so instead of inventing an agent.
 */
export default function DmcaPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Legal</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          Copyright &amp; the DMCA
        </h1>
        <p className="console-mono mt-4 text-[11.5px] text-native-text-dim">
          Designated Agent: to be registered with the US Copyright Office at launch. Email: dmca@xr.rrrtx.ai
        </p>

        <Section title="Sending a takedown notice">
          <p>
            If copyrighted work of yours appears in the hosted XR Business service without permission,
            email{" "}
            <a href="mailto:dmca@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
              dmca@xr.rrrtx.ai
            </a>{" "}
            with the following (17 U.S.C. §512(c)(3)):
          </p>
          <ul>
            <li>Your full name, address, telephone number, and email address.</li>
            <li>Identification of the copyrighted work you claim has been infringed.</li>
            <li>
              Identification of the material claimed to be infringing, with enough detail — a URL,
              workspace, or share link — for us to locate it.
            </li>
            <li>
              The statement: &ldquo;I have a good faith belief that use of the material in the manner
              complained of is not authorized by the copyright owner, its agent, or the law.&rdquo;
            </li>
            <li>
              The statement: &ldquo;I swear, under penalty of perjury, that the information in this
              notification is accurate and that I am the copyright owner, or am authorized to act on
              behalf of the owner, of an exclusive right that is allegedly infringed.&rdquo;
            </li>
            <li>Your physical or electronic signature.</li>
          </ul>
          <p>
            We disable access to material named in a valid notice promptly, tell the account holder what
            was removed and why, and terminate the accounts of repeat infringers.
          </p>
        </Section>

        <Section title="Sending a counter-notice">
          <p>
            If your material was removed and you believe that was a mistake or a misidentification, email
            the same address with (17 U.S.C. §512(g)(3)):
          </p>
          <ul>
            <li>Your full name, address, telephone number, and email address.</li>
            <li>
              Identification of the material that was removed, and where it appeared before removal.
            </li>
            <li>
              The statement: &ldquo;I swear, under penalty of perjury, that I have a good faith belief
              that the material was removed or disabled as a result of mistake or misidentification of
              the material to be removed or disabled.&rdquo;
            </li>
            <li>
              The statement: &ldquo;I consent to the jurisdiction of the Federal District Court for the
              judicial district in which my address is located (or, if outside the United States, for any
              judicial district in which XR may be found), and I will accept service of process from the
              person who provided the original notification or an agent of such person.&rdquo;
            </li>
            <li>Your physical or electronic signature.</li>
          </ul>
          <p>
            We forward counter-notices to the original complainant. If they do not tell us within 10–14
            business days that they have filed a court action to restrain the material, we restore it.
          </p>
        </Section>

        <Section title="What this does not cover">
          <p>
            Content on your own machine, or in a workspace you merely use XR to look at, never reaches our
            servers, so there is nothing for us to take down. Notices about such material should go to
            whoever hosts it.
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-[15px] font-semibold text-native-text">{title}</h2>
      <div className="mt-3 space-y-3.5 text-[13px] leading-relaxed text-native-text-muted [&_li]:leading-relaxed [&_strong]:font-medium [&_strong]:text-native-text [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
