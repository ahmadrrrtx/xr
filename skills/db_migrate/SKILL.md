---
id: db_migrate
version: 1
source: preloaded
tools: [read_file, write_file]
verifier: { kind: file_exists, path: "" }
signed: false
---
# DB Migrate
1. Read the schema change description / current schema.
2. Generate a forward + rollback migration file in the project's format.
3. Success = the migration file exists.
