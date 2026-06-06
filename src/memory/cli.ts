/**
 * XR v0.9 — `xr memory …` command handlers.
 *
 * Thin handlers over MemoryStore. Every destructive action is explicit and
 * confirmable. Nothing here ever prints raw secrets.
 *
 *   xr memory                 status + summary
 *   xr memory list            list entries (--scope, --category, --json)
 *   xr memory add "…"         add an entry (--category, --scope, --tag, --importance)
 *   xr memory edit <id> "…"   edit content / fields
 *   xr memory remove <id>     delete one entry
 *   xr memory search "…"      keyword search
 *   xr memory recall "…"      relevance recall (what the agent would see)
 *   xr memory export [path]   export to JSON (stdout if no path)
 *   xr memory import <path>   import a JSON bundle
 *   xr memory clear           delete everything (asks confirmation)
 *   xr memory summaries       list / clear session summaries
 */
import type { Store } from "../state/db.ts";
import { MemoryStore, projectScopeFromCwd } from "./store.ts";
import { MEMORY_CATEGORIES, isCategory, type MemoryCategory } from "./types.ts";
import { banner, ok, warn, info, confirm, colors as C } from "../interfaces/cli.ts";
import { isMemoryEnabled } from "../config/config.ts";
import { readFileSync, writeFileSync } from "node:fs";

interface Flags {
  scope?: string;
  category?: MemoryCategory;
  tags: string[];
  importance?: number;
  json: boolean;
  yes: boolean;
  /** Force deterministic lexical recall (skip embeddings). */
  lexical: boolean;
  rest: string[];
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = { tags: [], json: false, yes: false, lexical: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lexical") f.lexical = true;
    else if (a === "--scope") f.scope = argv[++i];
    else if (a === "--category" || a === "-c") {
      const c = argv[++i];
      if (c && isCategory(c)) f.category = c;
      else warn(`unknown category "${c}" — use one of: ${MEMORY_CATEGORIES.join(", ")}`);
    } else if (a === "--tag") {
      const t = argv[++i];
      if (t) f.tags.push(t);
    } else if (a === "--importance" || a === "-i") f.importance = Number(argv[++i]);
    else if (a === "--json") f.json = true;
    else if (a === "--yes" || a === "-y") f.yes = true;
    else f.rest.push(a);
  }
  return f;
}

function fmtTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

function colorCat(cat: string): string {
  switch (cat) {
    case "preference":
      return C.green(cat);
    case "project":
      return C.cyan(cat);
    case "workflow":
      return C.yellow(cat);
    case "exclusion":
      return C.red(cat);
    default:
      return C.dim(cat);
  }
}

function printEntry(e: ReturnType<MemoryStore["list"]>[number]): void {
  const stars = "★".repeat(e.importance) + "☆".repeat(5 - e.importance);
  console.log(
    `  ${C.dim(e.id)}  ${colorCat(e.category.padEnd(10))} ${C.dim(stars)} ${e.content}`,
  );
  const meta = [
    `scope=${e.scope}`,
    `src=${e.source}`,
    e.tags.length ? `tags=${e.tags.join(",")}` : "",
    fmtTime(e.updatedAt),
  ]
    .filter(Boolean)
    .join(" · ");
  console.log(`      ${C.dim(meta)}`);
}

// ── subcommands ──────────────────────────────────────────────────────────

function cmdStatus(mem: MemoryStore): void {
  banner();
  const enabled = isMemoryEnabled();
  console.log(C.bold("🧠 XR Memory"));
  console.log(`  enabled .......... ${enabled ? C.green("✓ yes") : C.red("✗ disabled")}`);
  console.log(`  entries .......... ${C.cyan(String(mem.count()))}`);
  const stats = mem.stats();
  if (stats.length) {
    for (const s of stats) {
      console.log(`    ${colorCat(s.category.padEnd(11))} ${C.dim(String(s.c))}`);
    }
  }
  console.log("");
  if (!enabled) {
    warn('memory is disabled — re-enable in config: control? no; set "memory.enabled": true');
  }
  info('add with: xr memory add "I prefer TypeScript and Bun" --category preference');
  info('inspect:  xr memory list   ·   recall: xr memory recall "preferences"');
}

function cmdList(mem: MemoryStore, f: Flags): void {
  const entries = mem.list({
    scope: f.scope,
    category: f.category,
    includeExclusions: f.category === "exclusion",
  });
  if (f.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  banner();
  console.log(C.bold(`🧠 Memory (${entries.length})`));
  if (!entries.length) {
    info("nothing stored yet.");
    info('try: xr memory add "this project is called XR" --category project');
    return;
  }
  for (const e of entries) printEntry(e);
  // Exclusions are hidden unless explicitly requested; tell the user they exist.
  if (f.category !== "exclusion") {
    const exCount = mem.list({ category: "exclusion", includeExclusions: true }).length;
    if (exCount) {
      console.log("");
      info(`${exCount} do-not-remember rule(s) hidden — view with: xr memory list --category exclusion`);
    }
  }
}

function cmdAdd(mem: MemoryStore, f: Flags): void {
  const content = f.rest.join(" ").trim();
  if (!content) {
    warn('usage: xr memory add "<text>" [--category <c>] [--scope <s>] [--tag t] [--importance 1-5]');
    return;
  }
  const res = mem.add({
    content,
    category: f.category,
    scope: f.scope,
    source: "user",
    tags: f.tags,
    importance: f.importance,
  });
  if (!res.ok) {
    warn(`not stored: ${res.reason}`);
    return;
  }
  if (res.duplicate) {
    info(`already remembered (${res.entry!.id}) — no duplicate created.`);
    return;
  }
  ok(`remembered ${C.dim(res.entry!.id)} · ${colorCat(res.entry!.category)}`);
}

function cmdEdit(mem: MemoryStore, f: Flags): void {
  const id = f.rest[0];
  const content = f.rest.slice(1).join(" ").trim();
  if (!id) {
    warn("usage: xr memory edit <id> [new text] [--category c] [--scope s] [--importance n] [--tag t]");
    return;
  }
  const patch: Parameters<MemoryStore["update"]>[1] = {};
  if (content) patch.content = content;
  if (f.category) patch.category = f.category;
  if (f.scope) patch.scope = f.scope;
  if (f.importance !== undefined) patch.importance = f.importance;
  if (f.tags.length) patch.tags = f.tags;
  if (Object.keys(patch).length === 0) {
    warn("nothing to change — pass new text and/or flags.");
    return;
  }
  const res = mem.update(id, patch);
  if (!res.ok) {
    warn(`edit failed: ${res.reason}`);
    return;
  }
  ok(`updated ${C.dim(res.entry!.id)}`);
}

function cmdRemove(mem: MemoryStore, f: Flags): void {
  const id = f.rest[0];
  if (!id) {
    warn("usage: xr memory remove <id>");
    return;
  }
  const res = mem.remove(id);
  if (res.ok) ok(`forgotten ${C.dim(id)}`);
  else warn(`remove failed: ${res.reason}`);
}

function cmdSearch(mem: MemoryStore, f: Flags): void {
  const q = f.rest.join(" ").trim();
  if (!q) {
    warn('usage: xr memory search "<text>"');
    return;
  }
  const results = mem.search(q, { scope: f.scope });
  if (f.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  banner();
  console.log(C.bold(`🔎 Search "${q}" (${results.length})`));
  if (!results.length) {
    info("no matches.");
    return;
  }
  for (const e of results) printEntry(e);
}

async function cmdRecall(mem: MemoryStore, f: Flags): Promise<void> {
  const q = f.rest.join(" ").trim();
  if (!q) {
    warn('usage: xr memory recall "<text>" [--lexical]');
    return;
  }
  // Mirror chat behaviour: semantic by default, lexical when forced.
  const results = f.lexical
    ? mem.recall(q, { scope: f.scope })
    : await mem.recallSemantic(q, { scope: f.scope });
  if (f.json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  banner();
  console.log(C.bold(`🧠 Recall "${q}" (${results.length})`));
  info(
    `this is exactly what XR would surface in chat/voice for that query (${f.lexical ? "lexical" : "semantic"}).`,
  );
  if (!results.length) {
    info("nothing relevant — XR would inject no memory for this.");
    return;
  }
  for (const e of results) printEntry(e);
}

/** Pre-compute embeddings for every entry (warms the semantic-recall cache). */
async function cmdReindex(mem: MemoryStore): Promise<void> {
  banner();
  console.log(C.bold("🧠 Re-embedding memory for semantic recall…"));
  const res = await mem.reindexEmbeddings();
  if (res.embedded === 0 && res.total === 0) {
    info("nothing to index — memory is empty.");
    return;
  }
  ok(`embedded ${res.embedded}/${res.total} entr${res.total === 1 ? "y" : "ies"}.`);
  if (res.fallback > 0) {
    info(
      `${res.fallback} used the lexical fallback (no embedding model reachable) — recall still works.`,
    );
  }
}

function cmdExport(mem: MemoryStore, f: Flags): void {
  const bundle = mem.export();
  const json = JSON.stringify(bundle, null, 2);
  const path = f.rest[0];
  if (!path) {
    console.log(json);
    return;
  }
  writeFileSync(path, json);
  ok(`exported ${bundle.entries.length} entr${bundle.entries.length === 1 ? "y" : "ies"} → ${path}`);
}

function cmdImport(mem: MemoryStore, f: Flags): void {
  const path = f.rest[0];
  if (!path) {
    warn("usage: xr memory import <path-to-json>");
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    warn(`could not read/parse ${path}: ${(e as Error).message}`);
    return;
  }
  const res = mem.import(parsed);
  if (res.added === 0 && res.skipped === 0 && res.errors === 1) {
    warn("not a valid xr-memory export bundle.");
    return;
  }
  ok(`imported: ${res.added} added · ${res.skipped} duplicate(s) · ${res.errors} error(s)`);
}

async function cmdClear(mem: MemoryStore, f: Flags): Promise<void> {
  const scope = f.scope;
  const what = scope ? `all memory for scope "${scope}"` : "ALL memory";
  const yes = f.yes || (await confirm(`Permanently delete ${what}?`, false));
  if (!yes) {
    info("cancelled.");
    return;
  }
  const n = mem.clear(scope);
  ok(`cleared ${n} entr${n === 1 ? "y" : "ies"}.`);
}

async function cmdSummaries(store: Store, f: Flags): Promise<void> {
  const sub = f.rest[0];
  if (sub === "clear") {
    const yes = f.yes || (await confirm("Delete all saved session summaries?", false));
    if (!yes) {
      info("cancelled.");
      return;
    }
    const n = store.clearSessionSummaries(f.scope);
    ok(`cleared ${n} summary(ies).`);
    return;
  }
  const rows = store.listSessionSummaries(f.scope);
  banner();
  console.log(C.bold(`📝 Session Summaries (${rows.length})`));
  info("these are conversation recaps — kept SEPARATE from long-term memory.");
  if (!rows.length) {
    info("none saved.");
    return;
  }
  for (const r of rows) {
    console.log(`  ${C.dim(r.id)} ${C.dim(fmtTime(r.created_at))} ${C.dim(`[${r.scope}]`)}`);
    console.log(`      ${r.summary.split("\n")[0].slice(0, 200)}`);
  }
}

function printHelp(): void {
  banner();
  console.log(`${C.bold("xr memory")} — durable, inspectable, user-controlled memory

${C.bold("Inspect")}
  xr memory                          status + counts by category
  xr memory list [--scope s] [--category c] [--json]
  xr memory search "<text>"          keyword search
  xr memory recall "<text>" [--lexical]  show exactly what chat/voice would surface
                                     (semantic by default; --lexical forces keyword scoring)
  xr memory reindex                  pre-compute embeddings (warms semantic recall)

${C.bold("Write")}
  xr memory add "<text>" [--category preference|project|workflow|fact|exclusion]
                         [--scope <s>] [--tag <t>] [--importance 1-5]
  xr memory edit <id> ["<new text>"] [--category c] [--scope s] [--importance n] [--tag t]
  xr memory remove <id>              forget one entry (permanent)
  xr memory clear [--scope s] [-y]   forget everything / one scope (permanent)

${C.bold("Portability")}
  xr memory export [path]            JSON bundle (stdout if no path)
  xr memory import <path>            merge a JSON bundle (dedupes)

${C.bold("Sessions")}
  xr memory summaries [clear] [--scope s]   conversation recaps (separate store)

${C.bold("Categories")}
  preference  durable choices (style, provider, tools)
  project     long-running project context
  workflow    repeated procedures
  fact        stable long-term facts
  exclusion   do-not-remember rules (never surfaced; hidden in list)

${C.dim("Memory is local-first and explicit by default — XR only remembers what you ask it to.")}`);
}

// ── entry point ────────────────────────────────────────────────────────────

export async function handleMemoryCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0];
  const flags = parseFlags(argv.slice(1));
  const mem = new MemoryStore(store);

  // Default the project scope for scope-aware reads when the user passes
  // `--scope .` (a convenience for "this project").
  if (flags.scope === ".") flags.scope = projectScopeFromCwd(process.cwd());

  if (!sub || sub === "status") return cmdStatus(mem);
  if (sub === "help" || sub === "--help" || sub === "-h") return printHelp();
  if (sub === "list" || sub === "ls") return cmdList(mem, flags);
  if (sub === "add") return cmdAdd(mem, flags);
  if (sub === "edit") return cmdEdit(mem, flags);
  if (sub === "remove" || sub === "rm" || sub === "forget") return cmdRemove(mem, flags);
  if (sub === "search") return cmdSearch(mem, flags);
  if (sub === "recall") return cmdRecall(mem, flags);
  if (sub === "reindex") return cmdReindex(mem);
  if (sub === "export") return cmdExport(mem, flags);
  if (sub === "import") return cmdImport(mem, flags);
  if (sub === "clear") return cmdClear(mem, flags);
  if (sub === "summaries" || sub === "summary") return cmdSummaries(store, flags);

  warn(`unknown memory subcommand: ${sub}`);
  printHelp();
}
