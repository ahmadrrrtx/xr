"use client";

import { useConsole, useResource } from "@/components/console/data";
import { Cell, ConsoleButton, DemoBanner, Empty, Notice, Panel, PageTitle, Row, StatusDot, Table } from "@/components/console/kit";
import { cloud, relativeDays, type Fact } from "@/lib/cloud";
import { demoFacts } from "@/lib/console-demo";

/**
 * Team memory.
 *
 * Shared facts are the feature people most often assume is a privacy problem, so
 * the page is built around making the boundary visible: what is here, who put it
 * here, and what is waiting for a decision.
 *
 * The review queue is presented as a first-class column rather than a filter,
 * because an unreviewed agent-suggested fact is the one state on this page where
 * doing nothing has a cost — it is visible to the team.
 */
export default function MemoryPage() {
  const { can, demo, demoReason } = useConsole();
  const { data } = useResource<{ facts: Fact[] }>("memory", (orgId) => cloud.memory(orgId), { facts: demoFacts });

  const facts = data.facts;
  const pending = facts.filter((f) => f.visibility === "review");

  return (
    <>
      <PageTitle
        title="Team memory"
        subtitle="Facts your team chose to share. Each one is encrypted with a key derived for its workspace, and nothing on this page came from anyone's private memory."
        actions={<ConsoleButton disabled={demo}>Add a fact</ConsoleButton>}
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title={`${facts.length} facts`} description="Last write wins, and every fact carries a version so a conflict is visible rather than silent.">
          {facts.length === 0 ? (
            <Empty title="Nothing shared yet" body="Team memory starts empty and stays empty until someone deliberately adds something to a team workspace." />
          ) : (
            <Table head={["Fact", "Workspace", "Visibility", "Version", "Updated", ""]}>
              {facts.map((fact) => (
                <Row key={fact.id}>
                  <Cell>
                    <div className="max-w-xl text-[12px] leading-relaxed text-native-text-muted">{fact.body}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="console-mono rounded border border-native-border px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-native-text-dim">
                        {fact.category}
                      </span>
                      {fact.tags.map((tag) => (
                        <span key={tag} className="console-mono text-[10px] text-native-text-dim">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </Cell>
                  <Cell mono dim>
                    {fact.workspaceId.replace("wsp_", "")}
                  </Cell>
                  <Cell>
                    <StatusDot
                      tone={fact.visibility === "review" ? "warn" : fact.visibility === "private" ? "neutral" : "ok"}
                      label={fact.visibility === "review" ? "Awaiting review" : fact.visibility}
                    />
                  </Cell>
                  <Cell mono dim>
                    v{fact.version}
                  </Cell>
                  <Cell dim>{relativeDays(fact.updatedAt)}</Cell>
                  <Cell>
                    {can("admin") ? <ConsoleButton disabled={demo}>Edit</ConsoleButton> : null}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Review queue" description="Agent-suggested facts wait here until a human accepts them.">
            <div className="space-y-3 p-4">
              {pending.length === 0 ? (
                <p className="text-[11.5px] text-native-text-dim">Nothing waiting.</p>
              ) : (
                pending.map((fact) => (
                  <div key={fact.id} className="rounded-md border border-native-border bg-native-bg p-3">
                    <p className="text-[11.5px] leading-relaxed text-native-text-muted">{fact.body.slice(0, 160)}…</p>
                    <div className="mt-3 flex gap-2">
                      <ConsoleButton variant="primary" disabled={demo}>
                        Accept
                      </ConsoleButton>
                      <ConsoleButton disabled={demo}>Reject</ConsoleButton>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Sensitivity scanning">
            <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
              <StatusDot tone="ok" label="Scanning runs locally, before upload" />
              <p>
                The same scanner that protects local memory runs before anything is sent here. A fact
                containing something that looks like a key, a card number or a national identifier is refused
                at the source, which means it never reaches this server and never appears in a log line about
                a rejected upload either.
              </p>
            </div>
          </Panel>

          <Panel title="On cancellation">
            <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
              <p>
                Every fact here is exportable as plaintext JSON for 30 days after a subscription ends. Local
                caches become read-only rather than disappearing, because a cache that vanishes when a bill is
                unpaid looks exactly like data loss.
              </p>
              <ConsoleButton disabled={demo}>Export plaintext</ConsoleButton>
            </div>
          </Panel>
        </div>
      </div>

      {!can("admin") ? (
        <div className="mt-5">
          <Notice tone="info" title="You can read and propose, not delete">
            Members can read team facts and propose new ones. Accepting, editing and deleting are
            administrative actions.
          </Notice>
        </div>
      ) : null}
    </>
  );
}
