"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/data";
import { Cell, DemoBanner, Meta, Notice, Panel, PageTitle, Row, StatusDot, Table } from "@/components/console/kit";
import { demoAudit, demoMembers, demoPolicy } from "@/lib/console-demo";
import { relativeDays, usd } from "@/lib/cloud";

/**
 * Console overview.
 *
 * Answers, in order, the four questions an owner actually opens this page to
 * answer: is anything broken, how much has the team spent, who is in it, and what
 * changed recently. Deliberately no charts — a sparkline of token spend over a
 * month answers none of those faster than a number does, and a bad chart is worse
 * than no chart.
 */
export default function OverviewPage() {
  const { team, entitlement, demo, demoReason, can } = useConsole();

  const members = demoMembers;
  const policy = demoPolicy;
  const recent = demoAudit.slice(0, 5);

  const active = members.filter((m) => m.status === "active").length;
  const byokOnly = members.filter((m) => m.byokOnly).length;

  return (
    <>
      <PageTitle
        title="Overview"
        subtitle="The state of this organization. Everything here is read from the cloud service; nothing about what individuals do on their own machines appears on this page."
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      {entitlement?.isPastDue ? (
        <div className="mb-5">
          <Notice tone="warn" title="The last payment did not go through">
            Stripe is retrying automatically and team features stay on meanwhile. Nothing on any
            member&rsquo;s machine is affected.{" "}
            <Link href="/dashboard/billing" className="text-native-cyan hover:underline">
              Update the payment method →
            </Link>
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="grid grid-cols-2 divide-native-border sm:grid-cols-4 sm:divide-x">
            <Meta label="Members" value={`${active} active`} />
            <Meta
              label="Seats billed"
              value={team ? String(entitlement?.seats ?? team.seats) : "—"}
            />
            <Meta label="Managed spend" value={usd(41_820_000)} />
            <Meta label="Monthly cap" value={usd(policy.teamMonthlyBudgetMicroUsd ?? 0)} />
          </div>
        </Panel>

        <Panel>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-native-text-dim">Subscription</span>
              <StatusDot
                tone={entitlement?.businessActive ? "ok" : "neutral"}
                label={
                  entitlement?.trial?.active
                    ? `Trial · ${entitlement.trial.daysLeft}d left`
                    : entitlement?.businessActive
                      ? "Active"
                      : "Personal"
                }
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-native-text-dim">SSO enforced</span>
              <StatusDot tone="ok" label="OIDC · Google" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-native-text-dim">Cloud relay</span>
              <StatusDot tone={policy.relayEnabled ? "ok" : "neutral"} label={policy.relayEnabled ? "Enabled" : "Off"} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-native-text-dim">Next invoice</span>
              <span className="text-[11.5px] text-native-text-muted">
                {relativeDays(entitlement?.currentPeriodEnd ?? null)}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel
          title="Recent activity"
          description="Administrative actions, newest first. Data-access events are recorded too and are visible in the audit log."
          actions={can("admin") ? <Link href="/dashboard/audit" className="text-[11.5px] text-native-cyan hover:underline">Audit log →</Link> : null}
        >
          <Table head={["Action", "Actor", "When"]}>
            {recent.map((entry) => (
              <Row key={entry.id}>
                <Cell mono>{entry.action}</Cell>
                <Cell dim>{entry.actorEmail ?? entry.actorKind}</Cell>
                <Cell dim>{relativeDays(entry.at)}</Cell>
              </Row>
            ))}
          </Table>
        </Panel>

        <Panel
          title="Attention"
          description="Things that are true right now and would surprise an owner."
        >
          <div className="space-y-3 p-4">
            <StatusDot tone={byokOnly > 0 ? "info" : "neutral"} label={`${byokOnly} member${byokOnly === 1 ? "" : "s"} on own keys (BYOK-only)`} />
            <StatusDot tone="warn" label="1 member disabled — local XR still works for them" />
            <StatusDot tone="info" label={`${policy.allowedProviders.length} providers allowed by policy`} />
            {policy.disableByok ? (
              <StatusDot tone="danger" label="BYOK is disabled — members cannot use their own keys" />
            ) : (
              <StatusDot tone="ok" label="BYOK is allowed, as it is on every plan" />
            )}
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="What this console can and cannot see" description="Stated on the overview because it is the question behind most support requests.">
          <div className="grid gap-px bg-native-border md:grid-cols-2">
            <div className="bg-native-bg-elevated p-4">
              <div className="text-[12px] font-medium text-native-ok">Visible here</div>
              <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-native-text-muted">
                <li>Membership, roles and per-member caps</li>
                <li>How many tokens and dollars each member used</li>
                <li>Facts the team deliberately shared to a team workspace</li>
                <li>Administrative actions and data-access events</li>
              </ul>
            </div>
            <div className="bg-native-bg-elevated p-4">
              <div className="text-[12px] font-medium text-native-danger">Not visible, to us or to you</div>
              <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-native-text-muted">
                <li>Any local conversation, file or terminal output</li>
                <li>Anyone&rsquo;s private memory, including their own team workspace</li>
                <li>Prompt or completion text — the log records model and token count only</li>
                <li>What anyone has installed, configured or is working on</li>
              </ul>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
