"use client";

import { useConsole, useResource } from "@/components/console/data";
import { Cell, ConsoleButton, DemoBanner, Notice, Panel, PageTitle, Row, StatusDot, Table } from "@/components/console/kit";
import { cloud } from "@/lib/cloud";
import { demoWorkspaces } from "@/lib/console-demo";

/**
 * Team workspaces.
 *
 * Deleting a workspace archives it. That is not a euphemism for a delete that
 * happens to be soft — the button says "Archive", the row keeps saying "Archived",
 * and the page explains why: a workspace is the unit that owns a memory key
 * namespace, and destroying it destroys every fact encrypted under it in one
 * unrecoverable step. Archiving keeps the facts readable and the key intact.
 */
interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  factCount: number;
  members?: number;
  visibility?: string;
}

export default function WorkspacesPage() {
  const { can, demo, demoReason } = useConsole();
  const { data } = useResource<{ workspaces?: WorkspaceRow[]; facts?: unknown[] }>(
    "workspaces",
    (orgId) => cloud.memory(orgId),
    { workspaces: demoWorkspaces },
  );

  const rows: WorkspaceRow[] = data.workspaces ?? demoWorkspaces;

  return (
    <>
      <PageTitle
        title="Workspaces"
        subtitle="A workspace is a shared context: its own team memory namespace, its own cache, and the unit everything else is scoped to."
        actions={
          can("admin") ? <ConsoleButton variant="primary" disabled={demo}>New workspace</ConsoleButton> : null
        }
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      <Panel title={`${rows.length} workspaces`} description="Every fact belongs to exactly one workspace and is encrypted with a key derived for that workspace alone.">
        <Table head={["Workspace", "Slug", "Facts", "Members", "Visibility", ""]}>
          {rows.map((workspace) => (
            <Row key={workspace.id}>
              <Cell>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-native-cyan/60" />
                  <span className="text-[12px] text-native-text">{workspace.name}</span>
                </div>
              </Cell>
              <Cell mono dim>
                {workspace.slug}
              </Cell>
              <Cell mono dim>
                {workspace.factCount}
              </Cell>
              <Cell mono dim>
                {workspace.members ?? "—"}
              </Cell>
              <Cell>
                <StatusDot
                  tone={workspace.visibility === "private" ? "neutral" : "ok"}
                  label={workspace.visibility === "private" ? "Private to one member" : "Team"}
                />
              </Cell>
              <Cell>
                {can("admin") ? (
                  <>
                    <ConsoleButton disabled={demo}>Rename</ConsoleButton>{" "}
                    <ConsoleButton variant="danger" disabled={demo}>
                      Archive
                    </ConsoleButton>
                  </>
                ) : null}
              </Cell>
            </Row>
          ))}
        </Table>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Panel title="Why archive instead of delete" className="lg:col-span-2">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <p>
              Each workspace has a memory key derived from the organization key and the workspace identifier.
              Deleting the workspace row would make every fact encrypted under that key permanently
              unreadable — including facts other people contributed and may still need. So the destructive
              action is archiving: the workspace disappears from pickers, no new facts can be written to it,
              and everything already in it stays readable and exportable.
            </p>
            <p>
              A hard delete exists for the case where that is genuinely what you want — offboarding a client,
              for instance — and it is deliberately not on this table. It is reachable from the workspace
              detail page, it states how many facts will be destroyed, and it asks you to type the workspace
              slug.
            </p>
          </div>
        </Panel>

        <Panel title="What is local and what is shared">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <StatusDot tone="neutral" label="Private memory never leaves the machine" />
            <StatusDot tone="ok" label="Only facts explicitly added to a team workspace sync" />
            <StatusDot tone="ok" label="Sensitivity scanning runs before upload" />
            <StatusDot tone="ok" label="Local caches are read-only until a conflict resolves" />
            <p className="border-t border-native-border pt-3 text-native-text-dim">
              A member can hold a local cache of shared facts for offline use. That cache is a copy, not a
              second source of truth, and it is discarded when the subscription ends rather than being kept as
              an orphan.
            </p>
          </div>
        </Panel>
      </div>

      {!can("admin") ? (
        <div className="mt-5">
          <Notice tone="info" title="Read-only for your role">
            You can see which workspaces exist and how much is in them. Creating, renaming and archiving are
            administrative actions.
          </Notice>
        </div>
      ) : null}
    </>
  );
}
