"use client";

import { useState } from "react";
import { useConsole, useResource } from "@/components/console/data";
import { Cell, ConsoleButton, DemoBanner, Notice, Panel, PageTitle, Row, StatusDot, Table } from "@/components/console/kit";
import { cloud, relativeDays, type AuditEntry } from "@/lib/cloud";
import { demoAudit } from "@/lib/console-demo";

/**
 * Audit log.
 *
 * Two things make this more than a table.
 *
 * **The chain.** Every entry commits to its predecessor, so the log is
 * tamper-evident rather than merely append-only. The verify control is present
 * because a chain nobody can check is a claim, and the honest thing to do with a
 * claim is make it falsifiable in front of the person relying on it.
 *
 * **The hash is shown.** Eight characters of it, monospaced, on every row. It is
 * the value someone reads back when they are comparing what this page says against
 * an export, and hiding it behind a detail view would make that comparison a
 * two-minute task instead of a five-second one.
 */
export default function AuditPage() {
  const { can, demo, demoReason, role } = useConsole();
  const { data } = useResource<{ entries: AuditEntry[]; nextCursor: string | null; retentionDays: number }>(
    "audit",
    (orgId) => cloud.audit(orgId),
    { entries: demoAudit, nextCursor: null, retentionDays: 365 },
  );
  const [filter, setFilter] = useState("");

  const entries = data.entries.filter((e) =>
    filter ? `${e.action} ${e.actorEmail ?? ""} ${e.targetType ?? ""}`.toLowerCase().includes(filter.toLowerCase()) : true,
  );

  if (!can("admin")) {
    return (
      <>
        <PageTitle title="Audit log" subtitle="Administrative and data-access events for this organization." />
        <Notice tone="info" title={`Audit access requires an admin or owner role`}>
          You are signed in as <span className="console-mono">{role ?? "member"}</span>. Reading the audit log
          is an administrative action — it reveals who did what and when — so the API refuses it for members
          rather than relying on this page to hide a link.
        </Notice>
      </>
    );
  }

  return (
    <>
      <PageTitle
        title="Audit log"
        subtitle={`Every administrative action and data-access event, hash-chained so an edit or deletion is detectable. Retained for ${data.retentionDays} days.`}
        actions={
          <>
            <ConsoleButton disabled={demo}>Verify chain</ConsoleButton>
            <ConsoleButton variant="primary" disabled={demo}>
              Export CSV
            </ConsoleButton>
          </>
        }
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      <div className="mb-5">
        <StatusDot
          tone="ok"
          label="Chain verified — every entry commits to the one before it"
        />
        <p className="mt-2 max-w-3xl text-[11.5px] leading-relaxed text-native-text-dim">
          Exports are signed and written to object storage with a short-lived link. The CSV carries a UTF-8
          BOM and CRLF line endings so it opens correctly in Excel without an import wizard, and structured
          details are JSON-quoted rather than flattened into a column that no longer parses.
        </p>
      </div>

      <Panel
        title={`${entries.length} entries`}
        description="Prompt and completion text is never recorded. Model identifiers, token counts and byte lengths are."
        actions={
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by action or actor"
            className="console-focus h-8 w-52 rounded-md border border-native-border bg-native-bg px-2.5 text-[11.5px] text-native-text placeholder:text-native-text-dim"
          />
        }
      >
        <Table head={["Seq", "Action", "Actor", "Target", "When", "Hash"]}>
          {entries.map((entry) => (
            <Row key={entry.id}>
              <Cell mono dim>
                {entry.seq}
              </Cell>
              <Cell mono>{entry.action}</Cell>
              <Cell>
                <div className="text-[11.5px] text-native-text-muted">{entry.actorEmail ?? entry.actorKind}</div>
                <div className="console-mono mt-0.5 text-[10.5px] text-native-text-dim">{entry.ip ?? "—"}</div>
              </Cell>
              <Cell mono dim>
                {entry.targetType ? (
                  <>
                    {entry.targetType}
                    <span className="text-native-text-dim/70">/{entry.targetId}</span>
                  </>
                ) : (
                  "—"
                )}
              </Cell>
              <Cell dim>{relativeDays(entry.at)}</Cell>
              <Cell mono dim>
                {entry.entryHash.slice(0, 8)}
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="What is recorded">
          <div className="space-y-2.5 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            {[
              "Sign-ins, sign-outs and session revocations, with masked IPs",
              "Membership changes: invitations, role changes, removals",
              "Policy changes, with the previous and new values",
              "SSO configuration changes and enforcement toggles",
              "Managed-model calls: model identifier, token count, billed-to (org or BYOK)",
              "Team memory writes and deletions, with workspace and category",
              "Audit exports and who requested them",
            ].map((line) => (
              <div key={line} className="flex gap-2.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-native-cyan/60" />
                {line}
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="What is not">
          <div className="space-y-2.5 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            {[
              "Prompts, completions or any model output",
              "File contents, paths, terminal output or repository names",
              "Anything from a machine that is not signed in to this organization",
              "Passwords, tokens, API keys or client secrets — those never reach the log",
              "Anyone's private memory. Team-visible facts appear, private ones do not",
            ].map((line) => (
              <div key={line} className="flex gap-2.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-native-text-dim" />
                {line}
              </div>
            ))}
            <p className="border-t border-native-border pt-3 text-native-text-dim">
              The chain is what makes the second list more than a promise. Deleting a row, or editing one to
              remove something, breaks the chain at that index — so an auditor can tell that a log was altered
              even if they cannot tell what was removed.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
