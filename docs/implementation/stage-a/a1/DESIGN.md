# A1 filesystem authority — design and acceptance record

Status: candidate design, **not accepted platform support**. No release/main mutation.

## Baseline and threat model

Accepted audit parent: `945c457c2495a4a79d1ef6d85651d38054479fd9`.
The supplied patch was checked and applied exactly once to a pristine fetched clone;
all 15 hashes matched. Separate checkpoint: `35d0a68ae5fa45be54dfe26ef7abb0f58c89a693`.
Packet checker: 63 hashes, four prompts, 73 planned cases, PASS. Historical results
are not this implementation's results.

Protect against model-chosen paths, hostile repository links, aliasing and path
replacement while waiting for approval. Do not claim protection against host root,
privileged mount manipulation, malicious native extensions or arbitrary same-UID
host compromise (which can read XR memory, rewrite its code or mutate open files).
Object identity, not a path string, is the authority. Concurrent directory relocation
by a privileged actor is not revocation of an already-open object; workspace switch
and explicit revocation must invalidate grants. Content voluntarily copied/renamed
by a trusted user to an innocuous single-link file cannot be classified by provenance.
No classifier can discover all secrets without reading them. Avoid claiming that.

## Operation-owning boundary

A shared authority in `src/security/` owns open/read/list/prepare-write/delete and
bounded traversal. It never exports a 'safe path' for arbitrary downstream I/O.
Identity includes actor, purpose, grant ID/generation, canonical root dev/inode,
relative target, target dev/inode/ctime/size and parent chain. Mutations retain
handles across approval; changed path/parent/target invalidates pending approval.
New destinations bind their existing ancestor and use no-follow exclusive creation.
Reads and previews use bounded regular-file snapshots, not a later path reopen.
Every component is anchored/no-follow, not just the last component.

Linux design: `openat2` with `RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS|
RESOLVE_NO_MAGICLINKS|RESOLVE_NO_XDEV` from a retained root FD; classify with O_PATH
before any content-bearing open; reject non-regular, multiple-link files before
reading. A private `/proc/self/fd` reopen of the retained regular-file descriptor
is an object operation, not a lookup through the user-controlled path. Check
identity at handoff. Existing-file writes act on the retained approved descriptor,
not a model pathname; missing paths use exclusive creation relative to a retained
parent. Errors are fixed policy codes, never raw filesystem or subprocess text.
No symlinks below the canonical root are followed, including in-root links. Root
aliases are resolved once at trusted authority acquisition and pinned thereafter.
Reject NUL/control characters, mixed foreign separators, drive/UNC spellings on
POSIX and traversal components. Case follows the native filesystem; sensitive
classification is case-insensitive. Hard links (`nlink != 1`) fail closed rather
than attempting to infer which name is the sensitive original. Mount crossings
fail closed below the grant root. Bounded depth/entries/bytes apply before reads.

**Platform gate:** this repository advertises Linux/macOS/Windows. A Linux native
primitive is not proof for macOS or Windows. Node/Bun's public path-based fs APIs
alone do not establish the required handle-relative Windows reparse/junction
semantics. Implementing or accepting a weaker realpath fallback is forbidden.
If the native implementations/evidence cannot be supplied, preserve a candidate
patch and report BLOCKED, not a silently Linux-only accepted product. Unsupported
operations must fail closed, but a global desktop/search disable is not acceptance.

## Sensitive content and trusted grants

Reuse `isSecretPath`, Trust `FilesystemPolicy`, `AuthorityGrant`, registry validation
and revocation. Classification applies to requested and canonical spellings. Exact
`.env.example`, `.env.sample`, `.env.template` may be explicit template exceptions;
not arbitrary suffixes. Default workspace access cannot read secrets, nor preview
old secret bytes for an edit. Yolo, edit consent, a renderer label or model args
cannot mint sensitive disclosure authority. A trusted host may provide a registered,
short-lived grant for an exact root/path, actor, purpose and operation. Every use
revalidates grant identity/expiry/revocation; a serialized object is not a capability.
Internal config/keychain reads remain trusted internal loading, not permission to
send those bytes to the provider. A4 must consume the same denial/grant identity:
a full workspace mount is not an authorized replacement for candidate snapshots.
Do not implement A4 placement/network changes here.

## Search and previews

Enumerate through authority before reading; read each candidate via authority to
a bounded snapshot. Both JS and real ripgrep search only these snapshots (rg stdin,
`--no-config`, sanitized env, explicit `-e`, no user paths). Ambient rg configuration,
ignore files, hidden defaults and post-filtering cannot be permission boundaries.
Ignore rules remain an ergonomic filter, read through the same authority.
Previews are built from the operation's snapshot, not a raw fs reread. Editor changes
must be committed by the prepared operation, never a second post-tool host write.
Daemon diffs/hunk reversals must operate on authorized snapshots, not `git diff`
reopening worktree paths or executing repository diff/textconv/external configuration.
Approval hashes must include authority identity, not only the model's path/content.

## Entry inventory (actual source inspected)

| Entry | Existing I/O / authority issue | Required migration |
|---|---|---|
| `tools/files.ts` | read, old-content diff, overwrite | operation-owned read and prepared mutation |
| `tools/search.ts` | rg path argv; JS stat+recursive read | authorized snapshots for both engines |
| `tools/system.ts` | directory stat/list, rm; shell Trust seam | owned list/delete; carry denied identity to shell |
| `cli/coder/mentions.ts` | file/range/folder attachment | same reader/list, no link traversal |
| `cli/coder/context.ts` | rules, package, ignore, walk; git metadata | same reader/list; sanitized git or snapshots |
| `cli/coder/session.ts` | preview reread, pending editor direct write | use prepared snapshot and owned commit |
| `control/preview.ts` | old-content diff/deletion first lines | same authority; no secret old bytes |
| `daemon/routes/files.routes.ts` | list/read/diff/revert/save | owned HTTP operations, no raw git worktree I/O |
| `control/files.ts`, `executor.ts`, `service.ts` | arbitrary absolute file paths after broad control permission | retain legitimate desktop scope, exact trusted grant, separate disclosure consent |
| `repo/{scope,scanner,ignore,indexer,hash,service}.ts` | check then read, index/snippet/hash/ignore | operation-owned enumeration and read; no stale indexed secret disclosure |
| `context/memory/rag.ts` | recursive stat/read/package before embeddings | same authority before indexing/disclosure |
| `services/multi-agent-orchestration.ts` | artifact claimed-path hash | shared bounded read, no alias-derived metadata |
| `daemon/routes/builder*.ts`, `builder-projects.ts`, `dev-servers.ts` | read/write/patch/backup/static server with project roots | scoped operation identity across approval and preview |
| `daemon/routes/git.routes.ts`, terminal routes | git/host shell may reopen worktree content | handoff gaps must be documented; do not weaken execution boundary |
| `plugins/{host,sandbox-worker}.ts` filesystem APIs | path check then read/write/list | host API must consume authority; plugin code loading separate trusted config boundary |
| `skills/loader.ts`, `plugins/skills.ts`, skill package body loaders | SOP content goes to models | authorize body reads separately from manifest/signature verification |
| config, state SQLite, keychain, TLS/VAPID, permission/pause/grant stores, installed-code integrity | internal bootstrap/control data | keep trusted; do not make provider content merely because internal loader can read it |
| CLI explicit import/export, install/update/release tools | trusted user-invoked operations, not model tools | do not globally jail or break command compatibility |

Raw source inventory is retained as a sanitized artifact (`raw-fs-inventory.txt`,
470 source matches before implementation). Every above path needs reviewed closure;
changing only the first three tools does **not** close F03.

## Compatibility / migration / rollback

No on-disk user-data migration or dependency upgrades. Existing tool JSON schemas
remain `read_file {path}`, `write_file {path,content}`, `search_code
{pattern,path,include}`, `shell {cmd}`; never add `command` as an alias. Retain
ordinary approved writes and scoped general desktop operations. Unsupported new
semantics are refusals, not fabricated success. Roll back candidate commits only;
never reset user work, erase ledgers or reapply the baseline. F09–F15 remain open.
The next agent requires an accepted exact A1 SHA and complete proof, not this branch.
