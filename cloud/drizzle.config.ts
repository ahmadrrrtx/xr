/**
 * drizzle-kit configuration.
 *
 * Migrations are generated SQL in `drizzle/`, committed, and applied by
 * `src/db/client.ts` at boot. Generating them at boot instead would make a
 * schema change a runtime surprise; committing them makes it a reviewable diff
 * (Constitution Art. XXIII — every migration has a rollback path).
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Only used by `db:studio` and `db:push`; the service itself uses DATABASE_URL.
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://xr:xr@localhost:5432/xr_cloud" },
  strict: true,
  verbose: true,
});
