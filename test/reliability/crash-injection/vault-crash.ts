/** Vault credential write; crash before commit → no partial ciphertext. */
import { WorkspaceStore } from "../../../src/state/workspace-store.ts";
import { CredentialVault } from "../../../src/integrations/credentials.ts";

const store = new WorkspaceStore("crash-vault", process.env.XR_DB!);
// BusinessDatabase normally creates this table; create it here so the vault
// write itself is the only transaction under test.
store.exec(`
  CREATE TABLE IF NOT EXISTS biz_credentials (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    connector_id TEXT,
    name TEXT NOT NULL,
    credentials TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
// Arm the crash AFTER setup so only the vault INSERT transaction is killed.
process.env.XR_CRASH_AT_WRITE = "before-commit";
const db = { prepare: (sql: string) => store.prepare(sql) } as never;
const vault = new CredentialVault(db, "vault-master-key");
vault.store("o1", {
  connectorId: "conn",
  name: "creds",
  credentials: { token: "secret-value" },
});
store.close();
