"use client";

import { useState } from "react";
import { useConsole, useResource } from "@/components/console/data";
import { Cell, ConsoleButton, DemoBanner, Empty, Notice, Panel, PageTitle, Row, StatusDot, Table } from "@/components/console/kit";
import { cloud, relativeDays, usd, type Member } from "@/lib/cloud";
import { demoMembers } from "@/lib/console-demo";

/**
 * Members.
 *
 * Per-member caps are the reason this page exists rather than a read-only list.
 * An organization that has been surprised by a bill wants one control: "this
 * person cannot spend more than X", and it needs to be on the same row as the
 * person rather than three clicks away in a policy editor.
 */
export default function MembersPage() {
  const { can, demo, demoReason, team, role } = useConsole();
  const { data, live } = useResource<{ members: Member[] }>(
    "members",
    (orgId) => cloud.members(orgId),
    { members: demoMembers },
  );
  const [pending, setPending] = useState<string | null>(null);

  const members = data.members;
  const seatCount = members.filter((m) => m.status === "active").length;

  return (
    <>
      <PageTitle
        title="Members"
        subtitle="Everyone with access to this organization, what they may do, and what they may spend. Removing a member never touches their local XR — it revokes access to team services."
        actions={
          can("admin") ? (
            <ConsoleButton variant="primary" disabled={demo} title="Invite a member">
              Invite member
            </ConsoleButton>
          ) : null
        }
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      {!can("admin") ? (
        <div className="mb-5">
          <Notice tone="info" title={`You are signed in as ${role ?? "a member"}`}>
            Members can read this list but cannot change roles, caps or invitations. The API enforces this
            independently of what this page chooses to show.
          </Notice>
        </div>
      ) : null}

      <Panel
        title={`${members.length} members · ${seatCount} billed seats`}
        description="A disabled member keeps working locally and loses access to shared workspaces, team memory and managed models."
      >
        {members.length === 0 ? (
          <Empty title="No members yet" body="Invite someone and they will appear here once they accept." />
        ) : (
          <Table head={["Member", "Role", "Status", "Daily cap", "Monthly cap", "Joined", ""]}>
            {members.map((member) => (
              <Row key={member.id}>
                <Cell>
                  <div className="flex items-center gap-2">
                    <span className="text-native-text">{member.name ?? "Unnamed"}</span>
                    {member.byokOnly ? (
                      <span className="console-mono rounded border border-native-border px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-native-text-dim">
                        byok only
                      </span>
                    ) : null}
                    {member.ssoBound ? (
                      <span className="console-mono rounded border border-native-border px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-native-text-dim">
                        sso
                      </span>
                    ) : null}
                  </div>
                  <div className="console-mono mt-0.5 text-[11px] text-native-text-dim">{member.email}</div>
                </Cell>
                <Cell>
                  <span className="console-mono text-[11.5px] text-native-text-muted">{member.role}</span>
                </Cell>
                <Cell>
                  <StatusDot
                    tone={member.status === "active" ? "ok" : "neutral"}
                    label={member.status === "active" ? (member.lastActiveAt && new Date(member.lastActiveAt).getTime() > Date.now() - 86_400_000 ? "Active now" : "Active") : "Disabled"}
                  />
                </Cell>
                <Cell mono dim>
                  {member.dailyCapMicroUsd === null ? "policy default" : usd(member.dailyCapMicroUsd)}
                </Cell>
                <Cell mono dim>
                  {member.monthlyCapMicroUsd === null ? "policy default" : usd(member.monthlyCapMicroUsd)}
                </Cell>
                <Cell dim>{relativeDays(member.joinedAt)}</Cell>
                <Cell>
                  {can("admin") && member.role !== "owner" ? (
                    <ConsoleButton
                      variant="danger"
                      busy={pending === member.id}
                      disabled={demo}
                      title="Remove from organization"
                      onClick={() => setPending(member.id)}
                    >
                      Remove
                    </ConsoleButton>
                  ) : null}
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Roles" description="Three roles. There is no custom-role editor and there will not be one until the permission model is worth customising.">
          <div className="space-y-3 p-4 text-[12px] leading-relaxed text-native-text-muted">
            <div>
              <span className="console-mono text-[11.5px] text-native-text">owner</span> — everything, including
              billing, deleting the organization and transferring ownership. An organization always keeps at
              least one; the API refuses the change that would remove the last one.
            </div>
            <div>
              <span className="console-mono text-[11.5px] text-native-text">admin</span> — members, invitations,
              SSO, policies, workspaces, audit and API keys. Cannot disable BYOK, because that decision affects
              how everyone else does their job.
            </div>
            <div>
              <span className="console-mono text-[11.5px] text-native-text">member</span> — uses the team&rsquo;s
              workspaces and memory. No administration.
            </div>
          </div>
        </Panel>

        <Panel title={`Seats and billing · ${team?.plan ?? "—"}`} description="Seats are active members. A disabled member stops being billed at the next period.">
          <div className="space-y-3 p-4 text-[12px] leading-relaxed text-native-text-muted">
            <div className="flex items-center justify-between">
              <span>Billed seats</span>
              <span className="console-mono text-[11.5px] text-native-text">{seatCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Subscription status</span>
              <StatusDot tone={live ? "ok" : "neutral"} label={(team?.planStatus ?? "unknown").replace("_", " ")} />
            </div>
            <div className="flex items-center justify-between">
              <span>Removing a seat</span>
              <span className="text-native-text-dim">next period</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Adding a seat</span>
              <span className="text-native-text-dim">prorated now</span>
            </div>
            <p className="border-t border-native-border pt-3 text-[11.5px] text-native-text-dim">
              Seats cannot be set below the number of active members — that would mean choosing which of your
              colleagues to evict, so the API refuses it and the message says so.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
