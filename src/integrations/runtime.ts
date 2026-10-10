/**
 * Phase 22 · Integrations — per-store service factory.
 *
 * One IntegrationService per store instance. The vault key is loaded from the
 * OS keychain on first use. Concurrent first calls share the same promise.
 */

import type { BusinessSqlDatabase } from '../core/business-l0.ts';
import { ConnectorRegistry } from './registry.ts';
import { ConnectionStore } from './connector-store.ts';
import { IntegrationService } from './service.ts';
import { ensureIntegrationSchema, openIntegrationVault } from './vault-adapter.ts';
import { registerRuntimeSecretResolver } from '../security/secret-broker.ts';

/** The subset of WorkspaceStore the integrations runtime needs. */
export interface IntegrationHost extends BusinessSqlDatabase {
  readonly workspaceId: string;
  audit(event: string, detail: Record<string, unknown>): unknown;
}

const registry = new ConnectorRegistry();
const services = new WeakMap<object, Promise<IntegrationService>>();

export function integrationServiceFor(host: IntegrationHost): Promise<IntegrationService> {
  const cached = services.get(host);
  if (cached) return cached;
  const created = (async () => {
    ensureIntegrationSchema(host);
    const vault = await openIntegrationVault(host);
    const service = new IntegrationService({
      registry,
      vault,
      connections: new ConnectionStore(host),
      workspaceId: host.workspaceId,
      audit: (event, detail) => {
        host.audit(event, detail);
      },
    });
    // Lets the MCP client read a connected integration's token at request time.
    // Memory only; the resolver ignores every name that is not an integration token.
    registerRuntimeSecretResolver((name) => service.mcpTokenFor(name));
    return service;
  })();
  // A failed open (for example, a missing keychain key) must not stay cached.
  created.catch(() => services.delete(host));
  services.set(host, created);
  return created;
}
