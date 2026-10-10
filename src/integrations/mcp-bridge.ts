/**
 * Phase 22 · Integrations — routes connected apps through the existing MCP path.
 *
 * A connected integration that has a hosted MCP endpoint gets a registry entry in
 * the existing MCP registry. It is default-deny: it starts disabled, and the user
 * enables it through the normal MCP flow (declared permissions must be approved).
 *
 * The entry stores only the NAME of the environment variable that carries the
 * token (apiKeyEnv). The token itself is resolved at request time from the
 * Integrations CredentialVault by the secret broker. It is never written to the
 * MCP registry, to a config file, or to the process environment.
 *
 * No new tool runtime: this module only registers configs. Calls go through the
 * existing McpClient and the existing wrapping, approvals and audit.
 */

import type { McpServerConfigInput } from '../mcp/types.ts';

export interface IntegrationMcpServer {
  serverId: string;
  name: string;
  version: string;
  description: string;
  url: string;
  /** Declared permissions, shown to the user for approval before the server can be enabled. */
  permissions: ReadonlyArray<'net'>;
}

/**
 * Connectors with a hosted MCP endpoint. Coolify has no hosted MCP server, so it
 * is not registered; it stays a plain Integrations connection.
 */
export const INTEGRATION_MCP_SERVERS: Readonly<Record<string, IntegrationMcpServer>> = {
  github: {
    serverId: 'integration-github',
    name: 'GitHub (via XR Integrations)',
    version: '1.0.0',
    description: 'GitHub hosted MCP server, signed in through the Integrations panel. Enable it here to let assistants use your GitHub account.',
    url: 'https://api.githubcopilot.com/mcp/',
    permissions: ['net'],
  },
};

/** Environment-variable name for a connector's token. Only the broker reads it. */
export function integrationTokenEnvName(connectorId: string): string {
  return `XR_INTEGRATION_${connectorId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
}

/** The connector that owns a token env name, or null when the name is not an Integrations token. */
export function connectorForTokenEnv(envName: string): string | null {
  for (const connectorId of Object.keys(INTEGRATION_MCP_SERVERS)) {
    if (integrationTokenEnvName(connectorId) === envName) return connectorId;
  }
  return null;
}

/** The subset of McpManager this module uses. Kept narrow so it can be tested without a store. */
export interface McpRegistrar {
  getServer(id: string): unknown;
  addServer(input: McpServerConfigInput): Promise<{ ok: boolean; reason?: string }>;
  remove(id: string): { ok: boolean; reason?: string };
}

export interface McpSyncResult {
  serverId: string | null;
  registered: boolean;
  reason?: string;
}

/**
 * Brings the MCP registry in line with the connection state. Connected: registers
 * the server if it is missing (disabled). Disconnected: removes it, which also
 * unloads it. Idempotent.
 */
export async function syncIntegrationMcpServer(
  mgr: McpRegistrar,
  connectorId: string,
  connected: boolean,
): Promise<McpSyncResult> {
  const server = INTEGRATION_MCP_SERVERS[connectorId];
  if (!server) return { serverId: null, registered: false };

  const present = mgr.getServer(server.serverId) !== undefined && mgr.getServer(server.serverId) !== null;
  if (!connected) {
    if (present) {
      const removed = mgr.remove(server.serverId);
      return { serverId: server.serverId, registered: !removed.ok, reason: removed.reason };
    }
    return { serverId: server.serverId, registered: false };
  }

  if (present) return { serverId: server.serverId, registered: true };

  const input = {
    id: server.serverId,
    name: server.name,
    version: server.version,
    description: server.description,
    source: 'remote',
    sourceUrl: server.url,
    transport: 'http',
    localOrRemote: 'remote',
    url: server.url,
    apiKeyEnv: integrationTokenEnvName(connectorId),
    declaredCapabilities: { tools: true },
    declaredPermissions: [...server.permissions],
  } as unknown as McpServerConfigInput;

  const added = await mgr.addServer(input);
  return { serverId: server.serverId, registered: added.ok, reason: added.reason };
}
