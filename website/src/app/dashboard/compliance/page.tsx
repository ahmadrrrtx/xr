"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/data";
import { DemoBanner, Notice, Panel, PageTitle, StatusDot } from "@/components/console/kit";

/**
 * Compliance.
 *
 * The point of this page is subtraction. A controls checklist that only ever
 * shows green is marketing, so the third column states, in every row, what the
 * control does *not* cover. The honest headline — that SOC 2 Type I is in progress
 * and Type II is not attempted — sits at the top where it cannot be missed.
 */
const CONTROLS = [
  { id: "CC6.1", name: "Logical access — authentication", state: "ok", note: "Covers the cloud service. Does not cover a local XR install, which has no remote authentication to control." },
  { id: "CC6.2", name: "Logical access — provisioning", state: "ok", note: "Role changes are re-read per request. Provisioning via SCIM is not implemented — members are added by invitation." },
  { id: "CC6.3", name: "Logical access — removal", state: "ok", note: "Removal is immediate. It cannot reach a machine that is offline, and it is not intended to." },
  { id: "CC6.6", name: "Boundary protection", state: "ok", note: "TLS 1.2+, HSTS, single-origin CORS. The relay is a separate boundary and is documented separately." },
  { id: "CC7.1", name: "Vulnerability detection", state: "warn", note: "Dependency scanning is automated. No external penetration test has been completed yet." },
  { id: "CC7.2", name: "Monitoring for anomalies", state: "ok", note: "Auth failures, rate-limit trips and webhook failures are logged with request ids." },
  { id: "CC7.3", name: "Incident response", state: "warn", note: "A written process exists and is exercised. No 24/7 on-call rotation — response times are best effort outside business hours." },
  { id: "CC8.1", name: "Change management", state: "ok", note: "Every change is a reviewed pull request; migrations are additive and reversible." },
  { id: "A1.2", name: "Availability — backups", state: "ok", note: "Daily database snapshots with a tested restore. Recovery objectives are stated in the self-host guide." },
  { id: "P4.1", name: "Privacy — data minimisation", state: "ok", note: "Prompts are not stored. Usage counters hold counts, not content." },
  { id: "P6.1", name: "Privacy — retention", state: "warn", note: "Erasure is request-based: the Data Rights Request path, verified and confirmed by email. Self-serve deletion controls are not shipped." },
  { id: "P8.1", name: "Privacy — consent", state: "ok", note: "Not applicable in the usual sense: there is no analytics, no advertising and no third-party cookie to consent to." },
];

export default function CompliancePage() {
  const { demo, demoReason } = useConsole();
  const implemented = CONTROLS.filter((c) => c.state === "ok").length;

  return (
    <>
      <PageTitle
        title="Compliance"
        subtitle="The controls that exist, the ones that do not, and what each one actually covers. Written for someone filling out a security questionnaire, not for a landing page."
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      <div className="mb-5">
        <Notice tone="warn" title="SOC 2 Type I — in progress. Type II — not attempted.">
          The controls below are implemented and evidenced. What remains for Type I is an independent
          auditor&rsquo;s opinion on their design. Type II observes controls over a period of months, which cannot
          be done retroactively for a release this young, and we would rather say so than imply a certificate
          exists. The{" "}
          <Link href="/security" className="text-native-cyan hover:underline">
            public trust page
          </Link>{" "}
          says the same thing in the same words.
        </Notice>
      </div>

      <div className="grid gap-5 lg:grid-cols-4">
        {[
          { label: "Controls active", value: `${implemented}/${CONTROLS.length}`, tone: "ok" as const },
          { label: "External pentest", value: "Not yet", tone: "warn" as const },
          { label: "Sub-processors", value: "4, listed", tone: "ok" as const },
          { label: "Analytics / tracking", value: "None", tone: "ok" as const },
        ].map((card) => (
          <Panel key={card.label}>
            <div className="p-4">
              <div className="text-[10.5px] uppercase tracking-wider text-native-text-dim">{card.label}</div>
              <div className="mt-2 flex items-center gap-2">
                <StatusDot tone={card.tone} label={card.value} />
              </div>
            </div>
          </Panel>
        ))}
      </div>

      <div className="mt-5">
        <Panel title="Controls" description="TSC reference, what it covers, and — the column that matters — what it does not.">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-native-border">
                  {["Ref", "Control", "State", "Scope and limits"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wider text-native-text-dim">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CONTROLS.map((c) => (
                  <tr key={c.id} className="console-row align-top hover:bg-white/[0.015]">
                    <td className="console-mono px-4 py-3 text-[11px] text-native-text-dim">{c.id}</td>
                    <td className="px-4 py-3 text-[12px] text-native-text">{c.name}</td>
                    <td className="px-4 py-3">
                      <StatusDot tone={c.state === "ok" ? "ok" : "warn"} label={c.state === "ok" ? "Active" : "Partial"} />
                    </td>
                    <td className="px-4 py-3 text-[11.5px] leading-relaxed text-native-text-muted">{c.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Evidence you can pull yourself" description="Every item here is self-service. Asking support for any of it is not required.">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            {[
              ["Audit log export", "CSV, hash-chained, with a signature you can verify offline", "/dashboard/audit"],
              ["Team memory export", "Plaintext JSON with every stored fact, available during the retention window", "/dashboard/memory"],
              ["Session and device list", "Every active session with a revoke control", "/dashboard"],
              ["Sub-processor list", "Public, with what each one can see", "/security"],
              ["Incident history", "Release notes and status page, including the entry for our own outages", "/status"],
            ].map(([label, note, href]) => (
              <div key={label} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-native-cyan/60" />
                <div>
                  <Link href={href as string} className="text-native-text hover:text-native-cyan">
                    {label}
                  </Link>
                  <div className="text-native-text-dim">{note}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Known gaps, stated plainly">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <div>
              <StatusDot tone="warn" label="No SCIM provisioning" />
              <p className="mt-1.5 text-native-text-dim">
                Deactivating someone in your IdP does not disable them here. Their session expires within
                fifteen minutes regardless, but an admin has to remove them, and that is a gap.
              </p>
            </div>
            <div>
              <StatusDot tone="warn" label="Team memory is not end-to-end encrypted" />
              <p className="mt-1.5 text-native-text-dim">
                It is encrypted at rest and in transit with keys we hold. Per-message E2E is planned, not
                shipped, and no marketing copy claims otherwise.
              </p>
            </div>
            <div>
              <StatusDot tone="warn" label="Single region by default" />
              <p className="mt-1.5 text-native-text-dim">
                Data residency beyond &ldquo;US default, EU on request&rdquo; is not available in v1.0.0.
              </p>
            </div>
            <div>
              <StatusDot tone="warn" label="No published sub-processor change notice" />
              <p className="mt-1.5 text-native-text-dim">
                We announce them in the changelog; there is no 30-day advance email yet.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
