/**
 * Phase 22 · Integrations — operation contract entries. Spread into the main
 * registry in contract.ts. Responses are the { ok, … } envelope from
 * integrations.routes.ts; no secret field is ever part of a response.
 */

import type { ApiOperationMeta } from "./contract.ts";
import {
  IntegrationAppCredentialsRequest,
  IntegrationConnectRequest,
  IntegrationEnvelope,
  IntegrationOAuthCompleteRequest,
  IntegrationOAuthStartResponse,
} from "./schemas-integrations.ts";

const integrations = { tag: "integrations", stability: "experimental" as const };
const CONNECTOR_ID = [{ name: "id", description: "Connector id from the registry (for example github, coolify)." }];

export const INTEGRATIONS_CONTRACT: Record<string, ApiOperationMeta> = {
  "integrations.list": {
    ...integrations,
    summary: "List built-in integrations with connection state. Secrets are never included.",
    template: "/api/integrations",
    response: IntegrationEnvelope,
  },
  "integrations.get": {
    ...integrations,
    summary: "Get one integration with its connection state.",
    template: "/api/integrations/{id}",
    response: IntegrationEnvelope,
    pathParams: CONNECTOR_ID,
  },
  "integrations.app_credentials": {
    ...integrations,
    summary: "Save the OAuth app client ID and secret (BYOK) in the credential vault.",
    template: "/api/integrations/{id}/app",
    request: IntegrationAppCredentialsRequest,
    response: IntegrationEnvelope,
    pathParams: CONNECTOR_ID,
  },
  "integrations.oauth.start": {
    ...integrations,
    summary: "Start an OAuth sign-in. Returns the provider authorize URL with PKCE and state.",
    template: "/api/integrations/{id}/oauth/start",
    response: IntegrationOAuthStartResponse,
    pathParams: CONNECTOR_ID,
  },
  "integrations.oauth.complete": {
    ...integrations,
    summary: "Finish an OAuth sign-in from the xr:// callback. Validates the single-use state and stores tokens in the vault.",
    template: "/api/integrations/oauth/complete",
    request: IntegrationOAuthCompleteRequest,
    response: IntegrationEnvelope,
  },
  "integrations.connect": {
    ...integrations,
    summary: "Connect an API-key integration. Secrets go to the vault after a successful probe.",
    template: "/api/integrations/{id}/connect",
    request: IntegrationConnectRequest,
    response: IntegrationEnvelope,
    pathParams: CONNECTOR_ID,
  },
  "integrations.sync": {
    ...integrations,
    summary: "Run a health probe and refresh the account and last-sync time. Refreshes the token first when needed.",
    template: "/api/integrations/{id}/sync",
    response: IntegrationEnvelope,
    pathParams: CONNECTOR_ID,
  },
  "integrations.disconnect": {
    ...integrations,
    summary: "Disconnect: revoke the grant (best effort) and delete the local token.",
    template: "/api/integrations/{id}/disconnect",
    response: IntegrationEnvelope,
    pathParams: CONNECTOR_ID,
  },
};
