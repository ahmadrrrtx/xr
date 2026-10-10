/**
 * Phase 22 · Integrations — routing connected apps through the existing MCP path.
 *
 * Covers: the registry entry (default-deny, token by env-var name only), idempotent
 * sync on connect and disconnect, the secret-broker resolver (memory only, audited,
 * connected-only), and the MCP HTTP client re-reading a rotated bearer per request.
 * No network and no keychain: provider HTTP is a fetch mock; the master key is fixed.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { IntegrationService } from "../../src/integrations/service.ts";
import { ConnectionStore } from "../../src/integrations/connector-store.ts";
import { ConnectorRegistry } from "../../src/integrations/registry.ts";
import { CredentialVault } from "../../src/integrations/credentials.ts";
import { PendingOAuthStore } from "../../src/integrations/oauth-state.ts";
import { ensureIntegrationSchema, integrationCredentialsDb } from "../../src/integrations/vault-adapter.ts";
import {
  INTEGRATION_MCP_SERVERS,
  connectorForTokenEnv,
  integrationTokenEnvName,
  syncIntegrationMcpServer,
  type McpRegistrar,
} from "../../src/integrations/mcp-bridge.ts";
import { registerRuntimeSecretResolver, secretBrokerSync } from "../../src/security/secret-broker.ts";
import { McpClient } from "../../src/mcp/client.ts";

const WS = "ws-mcp-test";
const MASTER = "mcp-test-master-key-0123456789abcdef";
const TOKEN = "gho_MCP_TEST_TOKEN_0001";
const ENV = "XR_INTEGRATION_GITHUB_TOKEN";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Minimal in-memory fake of the McpManager surface the bridge uses. */
function fakeRegistrar(initial: string[] = []) {
  const present = new Set(initial);
  const added: Array<Record<string, unknown>> = [];
  const removed: string[] = [];
  const mgr: McpRegistrar = {
    getServer(id) {
      return present.has(id) ? { id } : undefined;
    },
    async addServer(input) {
      added.push(input as unknown as Record<string, unknown>);
      present.add(String((input as { id: string }).id));
      return { ok: true };
    },
    remove(id) {
      removed.push(id);
      present.delete(id);
      return { ok: true };
    },
  };
  return { mgr, added, removed };
}

function serviceWithGithub(opts: { connect: boolean }) {
  const db = new Database(":memory:");
  ensureIntegrationSchema(db as never);
  const vault = new CredentialVault(integrationCredentialsDb(db as never), MASTER);
  const connections = new ConnectionStore(db as never);
  const audits: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return json({ access_token: TOKEN, token_type: "bearer", scope: "repo,read:org" });
    }
    if (url === "https://api.github.com/user") return json({ id: 7, login: "mcp-user", name: "MCP User" });
    return new Response("not mocked", { status: 599 });
  }) as typeof fetch;
  const service = new IntegrationService({
    registry: new ConnectorRegistry(),
    vault,
    connections,
    workspaceId: WS,
    pending: new PendingOAuthStore(),
    fetch: fetchImpl,
    audit: (event, detail) => audits.push({ event, detail }),
    env: {},
  });
  if (opts.connect) {
    service.saveAppCredentials("github", { clientId: "Iv1.mcptest01", clientSecret: "mcp_client_secret_value" });
    const { authorizeUrl } = service.startOAuth("github");
    const state = new URL(authorizeUrl).searchParams.get("state") as string;
    return { service, audits, db, state };
  }
  return { service, audits, db, state: "" };
}

let unregister: (() => void) | null = null;
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("registry entry (default-deny, no secret in the registry)", () => {
  test("connecting registers a disabled remote server that names the token env var only", async () => {
    const { mgr, added } = fakeRegistrar();
    const result = await syncIntegrationMcpServer(mgr, "github", true);
    expect(result.registered).toBe(true);
    expect(added.length).toBe(1);
    const entry = added[0];
    expect(entry.id).toBe("integration-github");
    expect(entry.url).toBe("https://api.githubcopilot.com/mcp/");
    expect(entry.transport).toBe("http");
    expect(entry.source).toBe("remote");
    expect(entry.apiKeyEnv).toBe(ENV);
    expect(entry.declaredPermissions).toEqual(["net"]);
    // The entry has no grant and no enabled flag. The user enables it in the MCP flow.
    expect("grantedPermissions" in entry).toBe(false);
    expect("enabled" in entry).toBe(false);
    // Nothing in the registrar input looks like a token.
    expect(JSON.stringify(entry)).not.toMatch(/gho_|ghp_|Bearer /);
  });

  test("registering twice is idempotent", async () => {
    const { mgr, added } = fakeRegistrar(["integration-github"]);
    const result = await syncIntegrationMcpServer(mgr, "github", true);
    expect(result.registered).toBe(true);
    expect(added.length).toBe(0);
  });

  test("disconnecting removes the entry, and removing a missing entry is a no-op", async () => {
    const present = fakeRegistrar(["integration-github"]);
    await syncIntegrationMcpServer(present.mgr, "github", false);
    expect(present.removed).toEqual(["integration-github"]);
    const absent = fakeRegistrar();
    await syncIntegrationMcpServer(absent.mgr, "github", false);
    expect(absent.removed).toEqual([]);
  });

  test("Coolify has no hosted MCP endpoint, so nothing is registered", async () => {
    const { mgr, added, removed } = fakeRegistrar();
    const result = await syncIntegrationMcpServer(mgr, "coolify", true);
    expect(result.serverId).toBeNull();
    expect(added.length + removed.length).toBe(0);
    expect(INTEGRATION_MCP_SERVERS.coolify).toBeUndefined();
  });
});

describe("token env names", () => {
  test("GitHub maps to XR_INTEGRATION_GITHUB_TOKEN and back, and unknown names map to null", () => {
    expect(integrationTokenEnvName("github")).toBe(ENV);
    expect(connectorForTokenEnv(ENV)).toBe("github");
    expect(connectorForTokenEnv("OPENAI_API_KEY")).toBeNull();
    expect(connectorForTokenEnv("XR_INTEGRATION_COOLIFY_TOKEN")).toBeNull();
  });
});

describe("secret-broker resolver serves the token at request time, only while connected", () => {
  test("no token before connecting; token while connected; none after disconnecting; every read audited", async () => {
    const flow = serviceWithGithub({ connect: true });
    unregister = registerRuntimeSecretResolver((name) => flow.service.mcpTokenFor(name));

    // Pending sign-in only: the connector is not connected yet, so no token is served.
    expect(secretBrokerSync(ENV)).toBeUndefined();

    await flow.service.completeOAuth({ code: "code-ok", state: flow.state });
    expect(secretBrokerSync(ENV)).toBe(TOKEN);

    const reads = flow.audits.filter((a) => a.event === "integration.credential.read");
    expect(reads.some((a) => a.detail.purpose === "mcp" && a.detail.connectorId === "github")).toBe(true);
    // The audit trail never contains the token.
    expect(JSON.stringify(flow.audits)).not.toContain(TOKEN);

    await flow.service.disconnect("github");
    expect(secretBrokerSync(ENV)).toBeUndefined();
  });

  test("the resolver ignores names that are not integration tokens", () => {
    const flow = serviceWithGithub({ connect: false });
    expect(flow.service.mcpTokenFor("OPENAI_API_KEY")).toBeUndefined();
    expect(flow.service.mcpTokenFor("XR_INTEGRATION_NOPE_TOKEN")).toBeUndefined();
  });
});

describe("MCP HTTP client re-reads the bearer per request", () => {
  test("a rotated token is sent on the next request without reloading the server", async () => {
    let current = "gho_first_token_value";
    unregister = registerRuntimeSecretResolver((name) => (name === "XR_INTEGRATION_GITHUB_TOKEN" ? current : undefined));

    const seen: string[] = [];
    const fetchMock = (async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push(headers.authorization ?? "");
      return new Response("{}", { status: 500 });
    }) as unknown as typeof fetch;

    const client = new McpClient(
      { id: "integration-github", url: "https://api.githubcopilot.com/mcp/", transport: "http", apiKeyEnv: ENV },
      fetchMock,
    );
    await client.connect().catch(() => undefined);
    current = "gho_rotated_token_value";
    await client.connect().catch(() => undefined);

    expect(seen[0]).toBe("Bearer gho_first_token_value");
    expect(seen[seen.length - 1]).toBe("Bearer gho_rotated_token_value");
  });
});
