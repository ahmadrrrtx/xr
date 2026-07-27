# Integration / Capability Guide — XR 5.3

## Capability Ecosystem (XR 5.2) Reused

No new capability ecosystem in Phase 10. Use existing `src/capabilities/`:

- Common descriptors: publisher, provenance, package-integrity, declared-vs-effective authority, dependency/compatibility, evidence-based discovery, certification contract tests, safe install/update/disable/quarantine/rollback
- Effective authority = declared ∩ policy ∩ grants - denied, denied wins
- Adapters for plugins, skills, MCP, providers, tools, workflows, integrations, artifact transforms

## Business Integrations

`src/integrations/registry.ts` 30+ connectors categorized, `oauth.ts` OAuth flow, `credentials.ts` CredentialVault encrypted.

### Trust / Capability Contracts

- Use capability descriptors for integrations: declare permissions, data scopes, network/credential/provider requirements, placement/risk
- Use trust/credential contracts: CredentialRef reference-only, no raw secret in prompts, CredentialBroker scopeFor exposes env var NAMES only, prepareInjection transient, redact scrubs secrets, revoke deletes, assertClean throws on leak
- No ambient credentials: external writes require policy/approval + credential scoping via trust service + privacy service
- Example: finance invoice send external write → privacy check requires approval (confidential + isCloud), approval request severity critical, recipients admin, then executionBridge checks trust tier2 requires elevated approval + credential ref task_scoped

### Privacy Integration

- LocalPrivacyService checkPrivacy for integration_sync operation, target isCloud true → may deny or require approval
- Private mode: employees restricted deny, meetings confidential require approval, biz_credentials restricted deny

### Business Module Integration

- CRM, sales, support, projects, etc use executionBridge for external calls
- ArtifactEvidenceService links integration results as artifacts with provenance

### CLI / Daemon

- `xr business integrations` (existing CLI biz integrations available/connected)
- Daemon routes not yet for integrations, but business privacy route shows policy
- Future Phase 11 will add remote execution, but Phase 10 stays local

### Testing

- Connector registry broad and categorized PASS
- Security policies enforce least privilege and workspace isolation PASS
- Credential broker reference-only, redacting, scopeFor NAMES only, prepareInjection transient, revoke, redact, assertClean PASS
