"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useConsole, useResource } from "@/components/console/data";
import { ConsoleButton, DemoBanner, Notice, Panel, PageTitle, StatusDot } from "@/components/console/kit";
import { CLOUD_API, cloud, cloudConfigured } from "@/lib/cloud";

/**
 * SSO configuration.
 *
 * The single most useful thing on this page is the SP metadata URL, because it is
 * the value an IdP administrator has to paste into their side and the one people
 * get wrong. It is generated from `API_URL` on the server rather than assembled
 * here, so the entity ID in the metadata and the entity ID the server validates
 * against cannot drift — a class of bug that presents as "the signature is
 * invalid" and takes an afternoon to diagnose.
 */
interface SsoView {
  configured: boolean;
  kind: string | null;
  provider: string | null;
  enabled: boolean;
  enforced: boolean;
  emailDomains: string[];
  metadataUrl: string | null;
}

export default function SsoPage() {
  const { can, demo, demoReason, team } = useConsole();
  const { data } = useResource<SsoView>("sso", (orgId) => cloud.sso(orgId), {
    configured: true,
    kind: "oidc",
    provider: "google",
    enabled: true,
    enforced: true,
    emailDomains: ["northwind.example"],
    metadataUrl: null,
  });
  const [copied, setCopied] = useState(false);

  /**
   * The three values an IdP administrator has to paste into their side.
   *
   * In demo mode they are still shown, with an example host, because three
   * em-dashes under a heading called "Service provider details" reads as "this
   * product has no SSO endpoints" — the opposite of the truth and the one thing
   * on the page a reader is here to copy. The `live` flag travels with the value
   * so the copy button can refuse to put a placeholder on someone's clipboard.
   */
  const live = cloudConfigured && Boolean(team);
  const origin = cloudConfigured ? CLOUD_API : "https://api.xr.rrrtx.ai";
  const orgId = team?.id ?? "org_example";
  const acsUrl = `${origin}/auth/sso/saml/${orgId}/acs`;
  const metadataUrl = `${origin}/auth/sso/saml/${orgId}/metadata`;

  async function copy(value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <PageTitle
        title="Single sign-on"
        subtitle="Let people sign in with the identity provider your company already runs. XR proves identity and nothing more — an IdP account does not grant membership of this team."
        actions={
          can("admin") ? (
            <ConsoleButton variant="primary" disabled={demo}>
              {data.configured ? "Edit configuration" : "Configure SSO"}
            </ConsoleButton>
          ) : null
        }
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Current configuration">
          <div className="divide-y divide-native-border">
            <Line label="Status">
              {data.configured ? (
                <StatusDot tone={data.enabled ? "ok" : "neutral"} label={data.enabled ? "Configured and enabled" : "Configured but disabled"} />
              ) : (
                <StatusDot tone="neutral" label="Not configured" />
              )}
            </Line>
            <Line label="Protocol">
              <span className="console-mono text-[11.5px] text-native-text">{data.kind?.toUpperCase() ?? "—"}</span>
            </Line>
            <Line label="Provider">
              <span className="text-[12px] text-native-text-muted">{data.provider ?? "—"}</span>
            </Line>
            <Line label="Enforcement">
              <StatusDot
                tone={data.enforced ? "warn" : "neutral"}
                label={data.enforced ? "Required for matching domains" : "Optional"}
              />
            </Line>
            <Line label="Verified email domains">
              <span className="console-mono text-[11.5px] text-native-text-muted">
                {data.emailDomains.length ? data.emailDomains.join(", ") : "—"}
              </span>
            </Line>
          </div>
        </Panel>

        <Panel title="What enforcement does" description="Worth reading before switching it on.">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <p>
              When enforced, people whose email is on a verified domain must sign in through the provider.
              Password and magic-link sign-in are refused for those addresses.
            </p>
            <p>
              It never adds anyone to the team. A successful SSO sign-in by someone who is not a member ends
              with a message saying so, and an admin has to invite them. Domain matching is a routing hint,
              not a trust signal.
            </p>
            <p className="text-native-text-dim">
              Local XR is unaffected either way. Enforcement cannot reach a machine that is not signed in, and
              there is no such thing as a remote wipe.
            </p>
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Service provider details" description="Give these to whoever administers your identity provider.">
          <div className="space-y-4 p-4">
            {!live ? (
              <p className="rounded-md border border-native-border bg-native-bg px-3 py-2 text-[11px] leading-relaxed text-native-text-dim">
                Example values. A connected console derives all three from this deployment&rsquo;s
                <span className="console-mono"> API_URL</span> and the real organization id, so the value in the
                metadata and the value the server validates against cannot drift apart.
              </p>
            ) : null}
            <Field
              label="Assertion Consumer Service (ACS) URL"
              value={acsUrl}
              onCopy={live ? () => copy(acsUrl) : undefined}
              copied={copied}
            />
            <Field
              label="SP metadata (XML)"
              value={metadataUrl}
              onCopy={live ? () => copy(metadataUrl) : undefined}
              copied={copied}
            />
            <Field label="Entity ID" value={metadataUrl} onCopy={live ? () => copy(metadataUrl) : undefined} copied={copied} />
            <p className="text-[11px] leading-relaxed text-native-text-dim">
              XR does not sign AuthnRequests, and the metadata says so. Claiming otherwise makes a correctly
              configured IdP reject every login with a signature error that looks like a certificate problem.
            </p>
          </div>
        </Panel>

        <Panel title="What we require from the provider">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <StatusDot tone="ok" label="Signed assertions — an unsigned assertion is refused" />
            <StatusDot tone="ok" label="Issuer and audience validated on every response" />
            <StatusDot tone="ok" label="PKCE (S256) and a nonce for OIDC" />
            <StatusDot tone="ok" label="State is single-use and expires in 10 minutes" />
            <StatusDot tone="ok" label="Sign-in responses are rejected if they arrive after the flow expires" />
            <p className="border-t border-native-border pt-3 text-native-text-dim">
              Client secrets and IdP certificates are encrypted with AES-256-GCM before they are stored, using
              a key held only by the deployment. The console never reads them back — once saved, a secret is
              write-only.
            </p>
          </div>
        </Panel>
      </div>

      {!can("admin") ? (
        <div className="mt-5">
          <Notice tone="info" title="Read-only for your role">
            SSO configuration is visible to members so nobody has to guess how they will sign in, but changing
            it requires an admin.
          </Notice>
        </div>
      ) : null}
    </>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <span className="text-[11.5px] text-native-text-dim">{label}</span>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  /** Omitted when the value is an example: a placeholder must not be copyable. */
  onCopy?: () => void;
  copied: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] text-native-text-dim">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <code className="console-mono min-w-0 flex-1 truncate rounded-md border border-native-border bg-native-bg px-2.5 py-2 text-[11px] text-native-text-muted">
          {value}
        </code>
        <ConsoleButton
          onClick={onCopy}
          disabled={!onCopy}
          title={onCopy ? "Copy" : "Example value — connect a cloud API to copy the real one"}
        >
          {copied ? <Check className="h-3 w-3 text-native-ok" /> : <Copy className="h-3 w-3" />}
        </ConsoleButton>
      </div>
    </div>
  );
}
