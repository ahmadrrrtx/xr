import { Metadata } from "next";
import Link from "next/link";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What the XR cloud service stores, why it stores it, how long it keeps it, and the things it never receives.",
};

const EFFECTIVE = "14 October 2026";

/**
 * `/legal/privacy`.
 *
 * Written to be read, which means it is organised around the reader's questions
 * rather than around regulatory categories. The important structural decision: it
 * separates **the local software** from **the hosted service** at the top, because
 * the single biggest source of confusion about a local-first product is a privacy
 * policy that reads as though the company can see everything.
 *
 * Every number in here is a real constant in the codebase. If the retention window
 * changes in `cloud/src/db/schema.ts`, this page changes in the same pull request —
 * a policy that describes a system nobody runs is worse than no policy.
 */
export default function PrivacyPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Legal</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          Privacy policy
        </h1>
        <p className="console-mono mt-4 text-[11.5px] text-native-text-dim">
          Effective {EFFECTIVE} · applies to {site.url}
        </p>
        <p className="console-mono mt-2 text-[11.5px] text-native-text-dim">
          Published by Muhammad Ahmad · XR [TO FILL: registered entity name, registered address, city,
          country] · privacy contact: privacy@xr.rrrtx.ai
        </p>

        <div className="mt-10 rounded-xl border border-native-cyan/25 bg-native-bg-elevated/60 p-6">
          <p className="text-[13px] leading-relaxed text-native-text">
            <strong className="font-medium">The short version.</strong> The XR you install on your machine
            does not send us anything. It does not have an analytics endpoint, a crash reporter or a licence
            heartbeat, and it works identically if you never create an account. This policy is about the
            cloud service that exists <em>only</em> for the Business tier — accounts, teams, billing, SSO,
            the relay and team memory. If you use XR alone, nothing on this page applies to you because
            there is nothing to apply it to.
          </p>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-native-text">
            <li>XR Personal is 100% local. We collect nothing.</li>
            <li>XR Business collects only what billing, accounts and team sync need.</li>
            <li>We do not sell data. No ads. No third-party trackers.</li>
            <li>You can export or delete everything at any time.</li>
          </ul>
        </div>

        <Section title="1. What the local software does with your data">
          <p>
            Nothing leaves your machine unless you ask it to. Prompts go from your machine directly to the
            model provider you configured, using the API key you supplied. XR is not in the middle and does
            not see them.
          </p>
          <p>
            XR stores your conversations, memory, workspaces, agents and settings in a local database in
            your own user directory. Uninstalling the app does not delete that directory, on the assumption
            that losing your memory because you reinstalled would be the wrong default. There is a
            documented command to delete it.
          </p>
          <p>
            The desktop application does not contact {site.name} servers at all in Personal mode. If you
            would like to verify that rather than take our word for it, the check is one command and it is
            written up in the security documentation.
          </p>
        </Section>

        <Section title="2. What the cloud service stores">
          <p>If you create a team, the following is stored on infrastructure we operate or rent:</p>
          <Table
            rows={[
              ["Account", "Email address, display name, an argon2id password hash if you set a password, and the timestamps of sign-in events.", "To let you sign in. The IP is stored masked after 24 hours — we keep the city-level prefix for abuse detection and discard the rest."],
              ["Organization", "Team name, a URL slug, member list with roles, and the invitation history.", "To run the team. Membership is what every authorization check reads."],
              ["Billing", "Stripe customer and subscription identifiers, seat count, plan, invoice history.", "To bill you and to answer 'what am I paying for'. We never receive or store a card number — checkout is hosted by Stripe."],
              ["Team memory", "The facts your team chose to share, encrypted per fact with a key derived per workspace, plus a digest for integrity.", "This is the feature. The plaintext is never written to the database."],
              ["Audit log", "Administrative actions and data-access events, hash-chained.", "So an auditor can be handed something that is tamper-evident rather than a CSV we could have edited."],
              ["Usage counters", "Per-user token counts and cost, per day and per month.", "To enforce spend caps. Counts are stored; the content that produced them is not."],
              ["Sessions", "Refresh token hashes, device user-agent, masked IP, expiry.", "To let you see and revoke devices. We store a hash, so a stolen database does not yield a usable session."],
            ]}
          />
        </Section>

        <Section title="3. What we never receive">
          <ul>
            <li>Your prompts or completions, when you use your own API keys. They never pass through us.</li>
            <li>Any file, repository, terminal output or screen content from your machine.</li>
            <li>Any analytics, telemetry, crash report or session recording, from the app or from this website.</li>
            <li>Your contacts, calendar, location or device identifiers.</li>
            <li>Anything at all, if you use XR without an account.</li>
          </ul>
          <p>
            When you use <strong>managed models</strong> a prompt does pass through the cloud service, because
            that is what proxying is. It is forwarded and metered, not stored: the audit entry records the
            model identifier and the prompt length, and the test suite asserts the prompt text is absent from
            the log. That is the one case in which we handle your content, and it only happens for teams that
            chose managed models over their own keys.
          </p>
        </Section>

        <Section title="4. How long we keep things">
          <Table
            rows={[
              ["Active accounts", "Until you delete them", "You can delete from the console. Deletion schedules a purge and emails you the date."],
              ["Deleted accounts and teams", "30 days, then purged", "The window exists so that a mistaken deletion is recoverable. After it closes, the data is gone — not archived, not retained."],
              ["Team memory and audit logs, after cancellation", "30 days, exportable", "Every day of the window you can export both in full. The purge date is shown in the console rather than buried in a policy."],
              ["Usage counters", "Current day and current month only", "Older counters are aggregated and the detail is discarded; there is no per-request history to subpoena."],
              ["Sign-in attempts", "90 days", "For abuse detection. Masked IP only."],
              ["Server and access logs", "14 days", "Standard request logs at the edge. No third-party analytics processor is involved."],
            ]}
          />
        </Section>

        <Section title="5. Who we share it with">
          <p>
            Four sub-processors, each listed with exactly what it sees on the{" "}
            <Link href="/security" className="text-native-cyan hover:underline">
              security page
            </Link>
            . Three of them are unreachable unless a customer action calls them. We do not sell data, we do
            not share it with advertisers, and there is no advertising SDK anywhere in the product or on this
            site.
          </p>
          <p>
            We disclose data to law enforcement when we are legally compelled to and the demand is valid on
            its face. Where we are permitted to tell you, we will. Where we are not, we will say so in a
            transparency note in the changelog once the gag order lapses — the audit chain means we cannot
            quietly produce data we never logged in the first place.
          </p>
        </Section>

        <Section title="6. Where it lives">
          <p>
            The hosted service runs in a single region in the United States by default, with a European
            region available on request for Enterprise. Self-hosting the whole control plane is supported and
            documented, and if you do that, no data reaches us at all.
          </p>
        </Section>

        <Section title="7. Your controls">
          <ul>
            <li>
              <strong>Export.</strong> Team memory as plaintext JSON and the audit log as CSV, at any time,
              from the console. Self-service, no support ticket.
            </li>
            <li>
              <strong>Delete.</strong> Account deletion from the console, with a 30-day recovery window and a
              confirmation email stating the purge date.
            </li>
            <li>
              <strong>Revoke.</strong> Every session and every device is visible under Settings and can be
              revoked individually. Revocation is immediate because roles and sessions are re-read per
              request rather than cached.
            </li>
            <li>
              <strong>Refuse.</strong> We set essential cookies only — the ones that keep you signed in —
              and the banner on this site exists to tell you that, not to ask permission for tracking that
              never happens. The full inventory is the{" "}
              <Link href="/cookies" className="text-native-cyan hover:underline">
                cookie policy
              </Link>
              .
            </li>
          </ul>
        </Section>

        <Section title="8. Your rights, and how to exercise them">
          <p>
            Under the GDPR, the UK GDPR, India&rsquo;s DPDP Act and the CCPA/CPRA (whichever applies to
            you), you can ask us to: show you what we hold, correct it, delete it, give it to you in a
            portable format (JSON export), restrict or object to a use, and withdraw consent where consent
            is the basis. Most of these are self-service in the console — export and delete need no ticket
            at all.
          </p>
          <p>
            For anything else, email{" "}
            <a href="mailto:privacy@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
              privacy@xr.rrrtx.ai
            </a>{" "}
            with the subject <strong>&ldquo;Data Rights Request&rdquo;</strong>. We respond within 30 days,
            and sooner where the law asks for sooner. You may also complain to your local supervisory
            authority; we would rather you emailed us first, but that is a preference, not a condition.
          </p>
          <p>
            <strong>India (DPDP).</strong> Grievance officer: [TO FILL: name], [TO FILL: email], [TO FILL:
            physical address], available [TO FILL: hours]. Grievances are acknowledged within 48 hours and
            answered within 30 days.
          </p>
        </Section>

        <Section title="9. On what basis we process it">
          <ul>
            <li>
              <strong>Contract</strong> — providing the service you signed up for: accounts, teams, billing,
              support.
            </li>
            <li>
              <strong>Legitimate interest</strong> — abuse prevention, security, and keeping the service
              running, balanced against your rights. Product feedback counts only when you opt in.
            </li>
            <li>
              <strong>Consent</strong> — only where we ask first. There is no newsletter in v1; if one ever
              exists, it will be opt-in and every message will carry an unsubscribe link.
            </li>
          </ul>
        </Section>

        <Section title="10. Children">
          <p>
            XR is not directed at children under 13, and we do not knowingly collect data from them.
            Business accounts require you to be 18 or older, or to have guardian consent where the DPDP Act
            sets the child threshold higher. If you believe a child has given us data, email the privacy
            contact above and we will delete it.
          </p>
        </Section>

        <Section title="11. International transfers and security">
          <p>
            Where data crosses a border, it does so under Standard Contractual Clauses or an equivalent
            safeguard. The hosted service uses TLS 1.2 or better in transit, AES-256-GCM encryption at rest
            for stored team data, role-based access control, tamper-evident audit logging, automatic
            redaction of secrets in logs, and signed webhooks. The honest detail — what is finished, what
            is not — lives on the{" "}
            <Link href="/security" className="text-native-cyan hover:underline">
              security and trust page
            </Link>
            .
          </p>
        </Section>

        <Section title="12. Changes">
          <p>
            Material changes are announced in the changelog and by email to organization owners at least 30
            days before they take effect. The version history of this document is in the public repository, so
            a change is a diff you can read rather than a note we claim to have sent.
          </p>
        </Section>

        <div className="mt-14 rounded-xl border border-native-border bg-native-bg-elevated/50 p-6">
          <p className="text-[12.5px] leading-relaxed text-native-text-muted">
            Questions about any of this, including requests that do not fit a form:{" "}
            <a href="mailto:privacy@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
              privacy@xr.rrrtx.ai
            </a>
            . A human answers. See also{" "}
            <Link href="/legal/terms" className="text-native-cyan hover:underline">
              the terms
            </Link>{" "}
            and the{" "}
            <Link href="/security" className="text-native-cyan hover:underline">
              security and trust page
            </Link>
            .
          </p>
        </div>
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

function Table({ rows }: { rows: ReadonlyArray<readonly [string, string, string]> }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-native-border">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="bg-native-bg-elevated/70">
            <th className="px-3.5 py-2.5 text-[10.5px] font-medium uppercase tracking-wider text-native-text-dim">Category</th>
            <th className="px-3.5 py-2.5 text-[10.5px] font-medium uppercase tracking-wider text-native-text-dim">Stored</th>
            <th className="hidden px-3.5 py-2.5 text-[10.5px] font-medium uppercase tracking-wider text-native-text-dim md:table-cell">
              Why
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([category, stored, why]) => (
            <tr key={category} className="border-t border-native-border align-top">
              <td className="px-3.5 py-3 text-[12px] text-native-text">{category}</td>
              <td className="px-3.5 py-3 text-[11.5px] leading-relaxed text-native-text-muted">
                {stored}
                <span className="mt-1 block text-[11px] text-native-text-dim md:hidden">{why}</span>
              </td>
              <td className="hidden px-3.5 py-3 text-[11.5px] leading-relaxed text-native-text-muted md:table-cell">{why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
