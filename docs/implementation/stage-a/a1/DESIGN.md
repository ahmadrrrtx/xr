# A1 filesystem authority — design, as-built record and acceptance status

**Status: IMPLEMENTED ON LINUX x64 (candidate); NOT ACCEPTED.** Platform acceptance is
BLOCKED for macOS and Windows (no native implementation, no proof), and the remote push is
BLOCKED (no authorised credential available to the agent). See `RESULTS.md` and `HANDOFF.json`.

## Identity

| Item | SHA |
|---|---|
| Baseline checkpoint (F01/F02, committed on `Stage-1`) | `35d0a68ae5fa45be54dfe26ef7abb0f58c89a693` |
| Accepted audit parent (public `main`) | `945c457c2495a4a79d1ef6d85651d38054479fd9` |
| A1 candidate commit (superseded by the next two) | `1d7c8f48a8611bb48927637d5285db7878aa5004` |
| Records commit (documentation of the candidate, not accepted) | `44b205a2` |
| **A1 implementation commit (tested)** | `e15a55002c9dd6bd6041af58f4252baaf9948a13` |
| Remote | not pushed (`origin` is HTTPS with no stored credential) |

Commit history is not rewritten. The A1 implementation commit is the tested SHA. This document
and `RESULTS.md` are a documentation-only successor commit of that SHA. No code changed after
the tested commit.

## Threat model (unchanged from the design below)

Protect against model-chosen paths, hostile repository links, aliasing, and path replacement
while an approval is pending. Not claimed: protection against host root, privileged mount
manipulation, malicious native extensions, or arbitrary same-UID compromise of the host (which
can read XR memory, rewrite XR code, or mutate open files). Object identity, not a path string,
is the authority. Content a trusted user copies to an innocuous single-link file cannot be
classified by provenance. No classifier can find all secrets without reading them.

## As-built architecture

- `src/security/fs-native.ts`: the only native primitive. Loads `libc.so.6` through `bun:ffi`.
  Path resolution uses `openat2` (syscall 437) from a retained root descriptor with
  `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV`
  (root acquisition uses `NO_SYMLINKS|NO_MAGICLINKS|BENEATH` without `NO_XDEV` so the host-selected
  canonical root may sit on a mount). Missing-destination creation uses `mkdirat`, `renameat`,
  and `unlinkat` relative to retained parents. Errors map to fixed codes
  (`denied|missing|stale|limit|unsupported|escape|binary`), never raw errno text.
- `src/security/filesystem.ts`: `FilesystemAuthority` / `withFilesystem(root, purpose, fn)`.
  Purposes: `model-tool`, `context`, `preview`, `daemon`, `desktop`, `index`, `plugin`. Operations:
  `metadata`, `list`, `read`, `readBytes`, `readPrefix`, `canRead`, `prepare` (write / create /
  rename / delete), with `commit`, `close`. Identity = dev/inode/ctime/size/nlink/mtime. Preparation
  retains the handles and parents so the approved object is the object committed. Reads return
  bounded regular-file snapshots. Limits: 10 MiB per file (aligned with the plugin cap), depth 32,
  10,000 entries. Hard links (`nlink != 1`) and non-regular files are refused before content I/O.
- A purpose-bound lease (`FilesystemLease`) carries grant ID, actor, generation, and denied paths.
  It is minted only by a trusted host adapter, is revalidated on every use, and is never parsed from
  model or HTTP arguments.
- Sensitive policy: `isSecretPath` from `src/security/guard.ts` on requested and canonical spellings,
  case-insensitively. Exact `.env.example|.env.sample|.env.template` are ordinary; nested suffixes
  and key-like names are sensitive.
- Consumers migrated in this candidate: model file tools and search (both engines work on authorised
  snapshots, `rg --no-config`, explicit `-e`, no user paths); daemon file routes; builder file routes
  (read/write/create/rename/delete, approval identity bound before consent); builder-dev diff apply
  and undo; dev-server static preview and project detection (`preview` purpose, `canRead`
  preflight); plugin host filesystem API (`src/plugins/fs-capability.ts`, `plugin` purpose); desktop
  control file actions (`desktop` purpose); RAG retrieve (every persisted chunk re-authorised before
  scoring); multi-agent artifact hashing (`context` purpose).

## Decisions and deviations from the original design text (disclosed)

1. **Platform scope.** The authority is implemented for Linux x64 and arm64 only. On any other
   platform every call fails closed with `unsupported`. The design's Windows reparse and macOS
   requirements are NOT implemented. No realpath fallback exists, as the design forbids. A1 cannot
   be accepted until native implementations and evidence exist (see the guarantee table).
2. **`/proc/self/fd` reopen.** `descriptorIo` reopens only the authority's own `O_PATH` descriptor
   through `/proc/self/fd/N`. This is an object operation on a retained handle, not a lookup of a
   model path. It is the only proc-based access.
3. **Size ceiling.** The authority ceiling is 10 MiB (was 5 MB in the earlier candidate). Plugin
   reads of 5–10 MB files work again. Files over 10 MB are refused. Static preview files over 10 MB
   now return 404 instead of being served (behaviour change).
4. **Binary plugin reads** are decoded as UTF-8 text by the plugin API (unchanged, but now documented).
5. **Desktop control scope is narrowed.** `src/control/files.ts` previously allowed absolute paths
   anywhere, gated only upstream. It now resolves paths under the root `XR_FILES_ROOT` or the home
   directory and refuses anything else. Outside-root desktop access is NOT granted by any trusted
   adapter in this candidate, so it fails closed. A general-desktop grant mechanism for outside
   paths is required by the plan and is still open. `move` now returns an explicit
   `unsupported` refusal, because no anchored cross-directory rename proof exists.
6. **RAG retrieve signature.** `retrieve(store, project, root, query, k)` takes a `root` so each
   chunk can be re-authorised. All callers were updated (typecheck passes).
7. **Builder status codes.** Escape → 400 (not 403). Authority denial → 403. Missing → 404.
   Stale (changed since load) → 409. Limit → 413. These are asserted in `builder-routes.test.ts`.
8. **Dead raw reader removed.** `src/repo/hash.ts` `hashFile` had no callers and read raw paths;
   removed. `sha256Bytes` remains.
9. **Ownership map** regenerated with `scripts/ownership-map.ts`; its `--check` is in sync.

## Residual raw filesystem use (inventory after the candidate)

Each item below is either trusted internal loading or an open item. None is a model-reachable
disclosure path that was found in this review. The adversarial review (RESULTS.md §Adversarial) lists
the open ones.

| Location | Use | Classification |
|---|---|---|
| `src/cli/coder/session.ts` `openInEditor` | writes the model's proposed content to a private `0600` temp file in `tmpdir()`, opens `$EDITOR`, reads it back | XR-owned temp file, not a workspace read. The edited text replaces the pending request's content (`req.replaceContent`), and the approved tool then runs through the authority. There is no separate host write. No dedicated test asserts this editor path yet (listed under open items). |
| `src/platform/environment/providers/vision.ts` `hashFile`, `observeArtifact`, `observeOcr` | raw read of an image path | Only caller is `control/computer-use.ts` with the path of an XR-captured screenshot. Not model-reachable in this candidate. OPEN: bind `imagePath` to the XR capture directory before any other caller is added. |
| `src/repo/scope.ts` `scopedStat`, `resolveInsideRoot` | `lstat`/`stat` metadata | Metadata only, no content. `scopedStat` is used only by tests. Recommend migrating or removing. OPEN. |
| `src/daemon/builder-projects.ts` | root `realpath`/`stat` at registration; `readdir`/write/read of the backups folder | Trusted root acquisition at project registration. Backups are XR-owned state under XR_HOME. Documented as trusted. |
| `src/daemon/routes/builder.routes.ts` `gitInfo` | `git rev-parse` and `git status --porcelain` in the project root | Git runs outside the authority. Contents are NOT read by XR, but untracked file **names** (for example `.env`) appear in the builder UI badges. OPEN: decide whether names of sensitive paths should be hidden. |
| `src/daemon/routes/builder.routes.ts` `loadProjectTypescript` | `import()` of `<project>/node_modules/typescript/lib/typescript.js` | **Executes project-controlled code** when the builder TypeScript check runs. Trusted-toolchain boundary, not a file-content disclosure. OPEN: this is a code-execution trust decision that the user must accept or restrict. |
| `src/plugins/loader/validation.ts`, `src/plugins/manifest.ts` | install-time manifest read, `stat`, tree hashing under realpath containment, no code loading | Trusted install-time validation of an untrusted plugin folder. Not model-visible. OPEN: manifest read uses `statSync`/`readFileSync` path-follow, not the authority. |
| `src/daemon/dev-servers.ts`, `src/daemon/routes/builder.routes.ts`, `builder-dev.routes.ts` `existsSync` | existence checks (for example `node_modules`) | Metadata only, no content. |
| `src/security/exec-integrity.ts` `hashFileContent` | hash of canonical executable path | Trusted installed-code integrity check. |
| `src/skills/*`, `src/plugins/skills.ts` skill-body loaders | skill package body reads | **NOT VERIFIED and NOT MIGRATED in this candidate.** Plan requires separate authorised body reads. OPEN. |
| Config, state SQLite, keychain, TLS/VAPID, grant, pause, and permission stores | internal bootstrap and control data | Trusted internal state. Kept out of provider content. |

## Shell seam and terminal/git handoff (known gaps)

`tools/system.ts` `shell` runs the real `cmd` through the existing guard and isolation seam. The
authority does not contain shell processes. A shell command can read any file its process can read.
This is the known gap referred to as F09–F15 scope and as the A4 handoff. The trusted policy here
is: model shell calls go through the configured guard. Denied commands never spawn. The daemon git and
terminal routes are unchanged and reopen worktree content through the host. A subprocess can read
everything the user account can read. A1 does not change the execution boundary.

## Platform guarantee table

| Platform | Guarantee in this candidate | Evidence | Status |
|---|---|---|---|
| Linux x64, glibc, kernel with openat2 (≥5.6) | Race-safe handle-relative authority as described above | Tested on this host: Linux 6.1.158 x86_64, glibc 2.41, openat2 probe returned a descriptor | **Candidate, tested on one host** |
| Linux arm64 | Same primitive compiled for arm64 (`openat2` = 437 on arm64) | Not run | NOT PROVEN |
| Linux musl / old kernels | `openat2` absent → `unsupported` (fail closed) | Not run | NOT PROVEN |
| macOS (any arch) | **Unsupported. Fails closed with `unsupported`.** No native implementation | None | **NOT PROVEN, NOT SUPPORTED. BLOCKS acceptance (FS12).** |
| Windows | **Unsupported. Fails closed with `unsupported`.** No junction or reparse implementation; Node path APIs do not provide handle-relative reparse semantics | None | **NOT PROVEN, NOT SUPPORTED. BLOCKS acceptance (FS12).** |
| Native IPC / Tauri desktop | Not exercised | None | NOT PROVEN |

The repository advertises Linux/macOS/Windows. Accepting A1 on Linux only would be a silently
narrower product, which the plan forbids. Acceptance therefore needs an explicit decision.

## F09–F15 boundaries (not addressed by A1)

- F09 Context wiring: not touched. The coder profile is unchanged.
- F10 Coding tools: not touched. Bounded reads and patch tools are unchanged.
- F11 Desktop quality: the desktop build passes. `desktop` lint still has a pre-existing settings-effect
  issue at baseline. Not changed.
- F12 Release and satellites: not touched. `release:check`, `channel:check`, `changelog:check` pass.
- F13 Dev pairing: not touched.
- F14 Version identity: not touched.
- F15 Package hygiene: not touched.

## Compatibility, migration, rollback

No on-disk user-data migration and no dependency upgrades. Tool schemas stay
`read_file {path}`, `write_file {path,content}`, `search_code {pattern,path,include}`, `shell {cmd}`.
There is no `command` alias. Ordinary approved writes and in-root operations are unchanged.
Behaviour changes: desktop file control root-bound and `move` refused; 10 MiB ceiling; static
preview over 10 MB → 404; RAG retrieval re-authorises chunks (stale or secret rows are no longer
returned); builder escapes → 400.

Rollback: revert commit `e15a5500` (and `1d7c8f48` / `44b205a2` if needed). Do not reset user work or
erase ledgers. Persisted RAG chunks and builder backups are unchanged by rollback. F01/F02 baseline
remains at `35d0a68a` and is independent.

## Original design (retained for reference)

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
