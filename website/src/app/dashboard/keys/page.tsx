"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { useConsole, useResource } from "@/components/console/data";
import { Cell, ConsoleButton, DemoBanner, Empty, Notice, Panel, PageTitle, Row, StatusDot, Table } from "@/components/console/kit";
import { cloud, relativeDays, type ApiKey } from "@/lib/cloud";
import { demoApiKeys } from "@/lib/console-demo";

/**
 * API keys.
 *
 * The show-once behaviour is the design, not an inconvenience. A key is displayed
 * exactly once, at creation, and only its SHA-256 is stored — so a database dump
 * yields hashes, and "we can look up your key for you" is a sentence this service
 * cannot say. The creation panel says that in advance rather than after the fact,
 * because discovering it after closing the dialog is how support tickets are born.
 *
 * Rotation is create-then-revoke rather than a rotate button, so there is never a
 * window in which no valid key exists.
 */
export default function KeysPage() {
  const { can, demo, demoReason, role } = useConsole();
  const { data } = useResource<{ keys: ApiKey[] }>("api-keys", (orgId) => cloud.apiKeys(orgId), { keys: demoApiKeys });
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!can("admin")) {
    return (
      <>
        <PageTitle title="API keys" subtitle="Programmatic access scoped to this organization." />
        <Notice tone="info" title="Requires an admin or owner role">
          You are signed in as <span className="console-mono">{role ?? "member"}</span>. An API key acts with
          the rights of the organization, so the API refuses this page for members rather than hiding it.
        </Notice>
      </>
    );
  }

  const keys = data.keys;

  return (
    <>
      <PageTitle
        title="API keys"
        subtitle="For CI pipelines and internal tools. Keys can only call the managed-model and usage endpoints — they cannot administer the team."
        actions={
          <ConsoleButton variant="primary" disabled={demo} onClick={() => setRevealed("xr_live_9Kd2PmQ4Tx7Vn1Rs8Lb3Wh6Yc5Az0Ej")}>
            Create key
          </ConsoleButton>
        }
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      {revealed ? (
        <div className="mb-5">
          <Panel title="Your new key — shown once">
            <div className="p-4">
              <p className="text-[11.5px] leading-relaxed text-native-text-muted">
                Copy it now. Only a hash is stored, so this value cannot be shown again and cannot be recovered
                by us. If it is lost, revoke it and create another — which takes ten seconds.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="console-mono min-w-0 flex-1 truncate rounded-md border border-native-cyan/30 bg-native-bg px-3 py-2.5 text-[11.5px] text-native-cyan">
                  {revealed}
                </code>
                <ConsoleButton
                  onClick={async () => {
                    await navigator.clipboard.writeText(revealed).catch(() => undefined);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }}
                >
                  {copied ? <Check className="h-3 w-3 text-native-ok" /> : <Copy className="h-3 w-3" />}
                  {copied ? "Copied" : "Copy"}
                </ConsoleButton>
                <ConsoleButton onClick={() => setRevealed(null)}>Done</ConsoleButton>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}

      <Panel
        title={`${keys.length} keys`}
        description="Revoking is immediate: the next request with that key is refused, with no propagation delay."
      >
        {keys.length === 0 ? (
          <Empty title="No API keys" body="Nothing programmatic is calling this organization. That is the normal state." />
        ) : (
          <Table head={["Name", "Prefix", "Scopes", "Created", "Last used", "Expires", ""]}>
            {keys.map((key) => (
              <Row key={key.id}>
                <Cell>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-3 w-3 text-native-text-dim" />
                    <span className="text-[12px] text-native-text">{key.name}</span>
                  </div>
                </Cell>
                <Cell mono dim>
                  {key.prefix}…
                </Cell>
                <Cell>
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="console-mono rounded border border-native-border px-1 py-0.5 text-[9.5px] text-native-text-dim"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </Cell>
                <Cell dim>{relativeDays(key.createdAt)}</Cell>
                <Cell dim>{key.lastUsedAt ? relativeDays(key.lastUsedAt) : "never"}</Cell>
                <Cell>
                  {key.expiresAt ? (
                    <StatusDot tone="warn" label={relativeDays(key.expiresAt)} />
                  ) : (
                    <span className="text-[11.5px] text-native-text-dim">no expiry</span>
                  )}
                </Cell>
                <Cell>
                  <ConsoleButton variant="danger" disabled={demo}>
                    Revoke
                  </ConsoleButton>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Scopes">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            {[
              ["models:invoke", "Call managed models on behalf of the organization. Counts against the org cap and the calling member's cap."],
              ["usage:read", "Read usage counters and cost. Useful for an internal dashboard; reveals nothing about content."],
              ["*", "Everything the key could otherwise do. Offered because some integrations cannot be made to work without it, and marked in the list so it is never chosen by accident."],
            ].map(([scope, note]) => (
              <div key={scope}>
                <span className="console-mono text-[11px] text-native-cyan">{scope}</span>
                <p className="mt-1 text-native-text-dim">{note}</p>
              </div>
            ))}
            <p className="border-t border-native-border pt-3 text-native-text-dim">
              A key can never administer the team. There is no scope that grants member management, billing or
              SSO — those require a signed-in session belonging to a person who can be named in an audit entry.
            </p>
          </div>
        </Panel>

        <Panel title="Rotating without downtime">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <ol className="space-y-2">
              <li>
                <span className="console-mono text-[11px] text-native-cyan">1.</span> Create a second key with
                the same scopes. Both are valid now.
              </li>
              <li>
                <span className="console-mono text-[11px] text-native-cyan">2.</span> Deploy the new value to
                whatever consumes it.
              </li>
              <li>
                <span className="console-mono text-[11px] text-native-cyan">3.</span> Confirm the old key shows
                no recent use.
              </li>
              <li>
                <span className="console-mono text-[11px] text-native-cyan">4.</span> Revoke it.
              </li>
            </ol>
            <p className="border-t border-native-border pt-3 text-native-text-dim">
              There is deliberately no &ldquo;rotate&rdquo; button. A single click that invalidates a live credential
              has to be coordinated with a deploy anyway, so it would only create a window in which nothing
              works.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
