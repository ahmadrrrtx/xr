#!/usr/bin/env bun
/**
 * XR Cloud — migration runner.
 *
 * Apply migrations from `drizzle/` and exit. This is a **separate process**, not
 * something the server does on boot, and that is deliberate:
 *
 *   - Two replicas booting at once would race the same DDL. Postgres would
 *     serialize them and one would fail on an already-applied statement, turning a
 *     deploy into a coin flip.
 *   - A migration is a change to production data. It belongs in a deploy step
 *     whose output a human reads, not buried in a container's startup log.
 *   - Rolling back means re-running an older build against the older schema. If
 *     the server migrated itself, that decision would already have been made for
 *     the operator.
 *
 * `docker-compose.yml` runs this as a one-shot `migrate` service that the API
 * service depends on, so the ordering is enforced rather than documented.
 *
 * Usage:
 *   bun run src/db/migrate.ts            # apply everything pending
 *   bun run src/db/migrate.ts --status   # say what is pending, change nothing
 *   bun run src/db/migrate.ts --dry-run  # print the SQL that would run
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { loadEnv } from "../env.ts";
import { createDatabase } from "./client.ts";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "drizzle");

interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

async function loadMigrationFiles(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort(); // drizzle-kit names them 0000_, 0001_, … so lexical order is apply order

  const out: MigrationFile[] = [];
  for (const name of files) {
    out.push({ name, sql: await readFile(join(MIGRATIONS_DIR, name), "utf8") });
  }
  return out;
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const statusOnly = args.has("--status");
  const dryRun = args.has("--dry-run");

  const env = loadEnv(process.env, { reload: true });
  const database = await createDatabase((line) => process.stdout.write(`  ${line}\n`));

  try {
    const files = await loadMigrationFiles();
    if (files.length === 0) {
      process.stderr.write(
        "No migrations found in drizzle/. Run `bun run db:generate` after changing src/db/schema.ts.\n",
      );
      return 1;
    }

    // The applied set can only be read after the journal table exists, which
    // `migrate()` itself guarantees — so this asks the handle rather than
    // hand-rolling `select from __drizzle_migrations`.
    const applied = await database.appliedMigrations();
    const pending = files.filter((f) => !applied.includes(f.name));

    process.stdout.write(
      `\nXR Cloud migrations\n───────────────────\n` +
        `  driver : ${env.DATABASE_DRIVER}\n` +
        `  files  : ${files.length} found, ${applied.length} applied, ${pending.length} pending\n`,
    );

    if (pending.length === 0) {
      process.stdout.write("  result : nothing to do — schema is up to date\n\n");
      return 0;
    }

    for (const file of pending) {
      process.stdout.write(`  pending: ${file.name}\n`);
    }

    if (statusOnly) {
      process.stdout.write("\n  --status: no changes were made.\n\n");
      return 0;
    }

    if (dryRun) {
      process.stdout.write("\n  --dry-run: printing SQL, applying nothing.\n\n");
      for (const file of pending) {
        process.stdout.write(`\n-- ${file.name} ${"─".repeat(Math.max(0, 60 - file.name.length))}\n`);
        process.stdout.write(`${file.sql}\n`);
      }
      return 0;
    }

    const result = await database.migrate();
    process.stdout.write(
      `  result : applied ${result.applied.length} migration(s) in ${result.durationMs} ms\n\n`,
    );
    for (const name of result.applied) process.stdout.write(`  applied: ${name}\n`);
    process.stdout.write("\n");
    return 0;
  } catch (error) {
    process.stderr.write(
      `\nMigration failed.\n\n${error instanceof Error ? error.message : String(error)}\n\n` +
        "Each migration file runs inside a transaction, so a failure rolls that file back\n" +
        "completely. Fix the cause and re-run; nothing needs to be undone by hand.\n\n",
    );
    return 1;
  } finally {
    await database.close();
  }
}

process.exit(await main());
