"use client";

import { useConsole, useResource } from "@/components/console/data";
import { Cell, DemoBanner, Notice, Panel, PageTitle, Row, StatusDot, Table, ConsoleButton } from "@/components/console/kit";
import { cloud, usd, type PolicyView } from "@/lib/cloud";
import { demoPolicy } from "@/lib/console-demo";

/**
 * Policies.
 *
 * The rule this page exists to make legible: **team policy is a ceiling, never a
 * replacement.** When a member sets their own daily budget it is compared against
 * the team figure and the more restrictive one wins. A page that showed only the
 * team number would leave an owner believing they had overridden something they
 * had not.
 */
export default function PoliciesPage() {
  const { can, demo, demoReason, role } = useConsole();
  const { data } = useResource<{ policies: PolicyView; source: string; viewerRole: string }>(
    "policies",
    (orgId) => cloud.policies(orgId),
    { policies: demoPolicy, source: "defaults", viewerRole: "owner" },
  );

  const p = data.policies;

  return (
    <>
      <PageTitle
        title="Policies"
        subtitle="Spending limits, provider allowlists and data handling for everyone in this organization. These apply on top of each member's own settings and can only ever tighten them."
        actions={can("admin") ? <ConsoleButton disabled={demo}>Edit policy</ConsoleButton> : null}
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      {!can("admin") ? (
        <div className="mb-5">
          <Notice tone="info" title={`You are viewing as ${role ?? "a member"}`}>
            You can read the limits that apply to you. Changing them requires an admin or owner.
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Spending" description="Money is stored in micro-USD so that a $0.0004 request does not round to nothing.">
          <div className="divide-y divide-native-border">
            {[
              ["Pooled managed-model quota", p.includedQuotaMicroUsd, "Included across the whole organization each month."],
              ["Team monthly ceiling", p.teamMonthlyBudgetMicroUsd, "Hard stop. Requests are refused with a 402, not silently downgraded."],
              ["Default daily budget per member", p.defaultDailyBudgetMicroUsd, "Applied to members with no individual override."],
              ["Default monthly budget per member", p.defaultMonthlyBudgetMicroUsd, "Same, monthly."],
              ["Approval threshold", p.requireApprovalAboveMicroUsd, "A single request above this needs an admin to approve it first."],
            ].map(([label, value, note]) => (
              <div key={label as string} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[12.5px] text-native-text">{label as string}</span>
                  <span className="console-mono text-[12px] text-native-text">
                    {value === null ? "no limit" : usd(value as number)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-native-text-dim">{note as string}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Providers and BYOK" description="An allowlist, not a preference. Removing a provider blocks the provider.">
          <div className="space-y-3 p-4">
            {p.allowedProviders.map((entry) => (
              <div key={entry.provider} className="flex items-center justify-between">
                <span className="console-mono text-[12px] text-native-text">{entry.provider}</span>
                <span className="text-[11.5px] text-native-text-dim">
                  {entry.models?.length ? entry.models.join(", ") : "all models"}
                </span>
              </div>
            ))}
            <div className="border-t border-native-border pt-3">
              <StatusDot
                tone={p.disableByok ? "danger" : "ok"}
                label={p.disableByok ? "BYOK disabled — members must use managed models" : "BYOK allowed (members may bring their own keys)"}
              />
              <p className="mt-2 text-[11px] leading-relaxed text-native-text-dim">
                Only an owner can change this. Disabling BYOK means every request is billed to the
                organization, which is a decision about money rather than about security.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Data handling">
          <div className="divide-y divide-native-border">
            {[
              ["Team memory retention", `${p.dataRetentionDays} days after cancellation`, "Exportable throughout. Erasure by verified request, confirmed by email."],
              ["Audit retention", `${p.auditRetentionDays} days`, "Minimum 30. Exports are signed and immutable."],
              ["Sensitive-fact blocking", p.blockSensitiveMemory ? "On" : "Off", "Facts matching the credential scanner are refused before they leave the machine."],
              ["Cloud relay", p.relayEnabled ? "Enabled for this org" : "Disabled", "Frames are opaque; the relay holds no keys."],
            ].map(([label, value, note]) => (
              <div key={label} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[12.5px] text-native-text">{label}</span>
                  <span className="text-[12px] text-native-text-muted">{value}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-native-text-dim">{note}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Egress destinations" description="Where this organization's traffic may go. Anything not listed is refused before the request leaves the machine.">
          <Table head={["Destination", "Purpose"]}>
            {p.egressRules.map((rule) => (
              <Row key={rule.destination}>
                <Cell mono>{rule.destination}</Cell>
                <Cell dim>{rule.note ?? "—"}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>
      </div>

      <div className="mt-5">
        <Notice tone="info" title={`Source: ${data.source}`}>
          {data.source === "stored"
            ? "These values were saved by an admin and are being applied now."
            : "No policy has been saved for this organization, so the shipped defaults are shown. Saving one replaces all of it — the defaults are not merged with a partial policy."}
        </Notice>
      </div>
    </>
  );
}
