/**
 * XR Phase 11 — `xr repo` command implementation.
 */

import { Tokens } from "../core/tokens.ts";
import type { CommandContext } from "../core/command-registry.ts";
import type { WorkspaceStore } from "../state/workspace-store.ts";
import { createRepoIntelligence } from "./service.ts";
import { loadRepoConfig, structuralLanguageIds } from "./index.ts";

export async function handleRepoCommand(args: string[], store: WorkspaceStore, cwd: string): Promise<void> {
  const sub = (args[0] ?? "status").toLowerCase();
  const rest = args.slice(1);
  const intel = createRepoIntelligence({ workspaceId: store.workspaceId, root: cwd, store });
  const json = rest.includes("--json") || args.includes("--json");

  if (sub === "status") {
    const st = intel.status();
    if (json) {
      console.log(JSON.stringify({ ...st, config: loadRepoConfig(), languages: structuralLanguageIds() }, null, 2));
      return;
    }
    console.log(`repo intelligence  ${st.state}`);
    console.log(`  files ${st.files}  symbols ${st.symbols}  edges ${st.edges}`);
    console.log(`  cache hits ${st.cacheHits}  misses ${st.cacheMisses}  last ${st.durationMs}ms`);
    if (st.error) console.log(`  error: ${st.error}`);
    return;
  }

  if (sub === "index" || sub === "refresh") {
    const force = rest.includes("--force") || sub === "refresh";
    const st = await intel.index({ force });
    if (json) {
      console.log(JSON.stringify(st, null, 2));
      return;
    }
    console.log(`indexed ${st.files} files (${st.changedFiles} changed, ${st.cacheHits} cache hits) in ${st.durationMs}ms → ${st.state}`);
    return;
  }

  if (sub === "map") {
    const query = rest.filter((a) => !a.startsWith("--")).join(" ");
    const map = await intel.map(query);
    if (json) {
      console.log(JSON.stringify(map, null, 2));
      return;
    }
    process.stdout.write(map.text);
    console.error(`# ${map.tokens}/${map.budget} approx tokens · ${map.files} files · ${map.symbols} symbols · ${map.tokenEstimator}`);
    return;
  }

  if (sub === "search") {
    const query = rest.filter((a) => !a.startsWith("--")).join(" ");
    await intel.ensureIndexed();
    const hits = intel.search(query);
    if (json) {
      console.log(JSON.stringify(hits, null, 2));
      return;
    }
    for (const h of hits) {
      console.log(h.kind === "symbol" ? `${h.relativePath}:${h.startLine}  ${h.symbolKind} ${h.name}` : h.relativePath);
    }
    return;
  }

  if (sub === "symbol" || sub === "symbols") {
    const name = rest.filter((a) => !a.startsWith("--"))[0] ?? "";
    await intel.ensureIndexed();
    const found = intel.symbols(name);
    if (json) {
      console.log(JSON.stringify(found, null, 2));
      return;
    }
    for (const s of found) console.log(`${s.file}:${s.startLine}  ${s.kind} ${s.name}`);
    return;
  }

  if (sub === "deps" || sub === "dependencies") {
    const file = rest.filter((a) => !a.startsWith("--"))[0] ?? "";
    await intel.ensureIndexed();
    const dep = intel.dependencies(file);
    if (json) {
      console.log(JSON.stringify(dep, null, 2));
      return;
    }
    for (const e of dep.outbound) console.log(`→ ${e.kind} ${e.toFile}  (${e.specifier})`);
    for (const e of dep.inbound) console.log(`← ${e.fromFile}`);
    return;
  }

  if (sub === "diff") {
    const file = rest.filter((a) => !a.startsWith("--"))[0];
    const hunks = await intel.diff(file);
    if (json) {
      console.log(JSON.stringify(hunks, null, 2));
      return;
    }
    if (!hunks.length) {
      console.log("(no unstaged diff)");
      return;
    }
    for (const h of hunks) {
      console.log(`${h.relativePath}  +${h.additions} -${h.deletions}`);
      if (h.patch) console.log(h.patch);
    }
    return;
  }

  console.log("usage: xr repo [status|index|map|search|symbol|deps|diff] …");
}

export function storeFrom(ctx: CommandContext): WorkspaceStore {
  return ctx.registry.resolve(Tokens.Store);
}
