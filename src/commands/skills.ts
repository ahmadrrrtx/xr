/** XR 2.1A — Unified Skill Runtime CLI. */
import { Command, CommandContext } from "../core/command-registry.ts";
import { SkillService } from "../services/skill-service.ts";
import { colors as C, heading, ok, warn, error, tip } from "../interfaces/cli.ts";
import { SKILL_CATEGORIES, type SkillCategory, type SkillPermissionScope } from "../skills/schema.ts";
import type { UnifiedSkillRecord } from "../skills/adapters.ts";

type Parsed = { positional: string[]; flags: Record<string, string | boolean> };

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) flags[key] = args[++i];
      else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function boolFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true" || flags[key] === "1";
}

function printUnifiedSkill(row: UnifiedSkillRecord, verbose = false): void {
  const m = row.manifest;
  const status = row.health === "healthy" ? C.green("healthy") : row.health === "disabled" ? C.dim("disabled") : C.amber(row.health);
  console.log(`  ${C.bold(m.id)} ${C.dim(`v${m.version}`)} ${row.enabled ? C.green("enabled") : C.dim("disabled")} ${status} ${C.dim(row.kind)}`);
  console.log(`    ${m.description}`);
  console.log(`    ${C.dim(m.categories.join(" / "))}  ${m.tags.slice(0, 8).map((t) => `#${t}`).join(" ")}`);
  if (verbose) {
    console.log(`    source: ${row.source}  dir: ${row.dir}`);
    console.log(`    publisher: ${m.publisher}  verification: ${m.verification.level}`);
    console.log(`    permissions: ${m.permissions.map((p) => `${p.scope}${p.dangerous ? "!" : ""}`).join(", ") || "none"}`);
    console.log(`    dependencies: ${m.dependencies.map((d) => `${d.kind}:${d.id}${d.optional ? "?" : ""}`).join(", ") || "none"}`);
    console.log(`    commands: ${m.contributions.commands.map((c) => c.name).join(", ") || "none"}`);
    if (row.warnings.length) for (const w of row.warnings) console.log(`    ${C.amber("warning:")} ${w}`);
    if (row.errors.length) for (const e of row.errors) console.log(`    ${C.red("error:")} ${e}`);
  }
}

function printUsage(): void {
  heading("XR 2.1A Unified Skills");
  console.log("  xr skills list [--verbose]");
  console.log("  xr skills inspect <id>");
  console.log("  xr skills validate <dir>");
  console.log("  xr skills enable <id>");
  console.log("  xr skills disable <id>");
  console.log("  xr skills install-local <dir> [--grant fs:read,net]");
  console.log("  xr skills remove <id>");
  console.log("  xr skills migrate [root]");
  console.log("  xr skills doctor");
  console.log("");
  console.log("  Backward-compatible SDK/marketplace commands remain available:");
  console.log("  xr skill search <query> | create | package | publish | test | export | import | update");
}

export class SkillsCommand implements Command {
  name = "skill";
  description = "XR Unified Skill Runtime and SDK";
  usage = "xr skills <list|inspect|validate|enable|disable|install-local|remove|migrate|doctor>";

  async execute(ctx: CommandContext): Promise<void> {
    const service = ctx.container.resolve<SkillService>("skills");
    const parsed = parse(ctx.args);
    const action = parsed.positional[0] ?? "list";
    const rest = parsed.positional.slice(1);
    const flags = parsed.flags;

    try {
      switch (action) {
        case "help":
        case "--help":
          printUsage();
          return;

        case "list":
        case "ls":
        case "browse":
        case "marketplace": {
          const rows = service.listUnified();
          const category = typeof flags.category === "string" ? flags.category : undefined;
          const kind = typeof flags.kind === "string" ? flags.kind : undefined;
          const visible = rows.filter((row) => (!category || row.manifest.categories.includes(category as any)) && (!kind || row.kind === kind));
          heading(`Unified Skills (${visible.length})`);
          for (const row of visible) printUnifiedSkill(row, boolFlag(flags, "verbose"));
          return;
        }

        case "installed": {
          const rows = service.listUnified().filter((row) => row.installed);
          heading(`Installed Skills (${rows.length})`);
          for (const row of rows) printUnifiedSkill(row, boolFlag(flags, "verbose"));
          return;
        }

        case "search": {
          const query = rest.join(" ").trim();
          if (!query) { warn("provide a search query"); return; }
          const rows = service.searchUnified(query, typeof flags.limit === "string" ? Number(flags.limit) : 20);
          heading(`Skill Search: ${query}`);
          for (const row of rows) printUnifiedSkill(row, boolFlag(flags, "verbose"));
          return;
        }

        case "recommend":
        case "resolve": {
          const task = rest.join(" ").trim();
          if (!task) { warn("provide a task to resolve skills for"); return; }
          const result = service.resolve(task, typeof flags.limit === "string" ? Number(flags.limit) : 6);
          heading("Resolved Skills");
          for (const row of result.selected) printUnifiedSkill(row, true);
          if (!result.selected.length) warn("no enabled healthy skill matched this task");
          return;
        }

        case "inspect":
        case "info":
        case "show": {
          const id = rest[0];
          if (!id) { warn("provide a skill id"); return; }
          const row = service.inspectUnified(id);
          if (!row) { error(`skill not found: ${id}`); return; }
          const perms = service.permissionReport(row.manifest.id);
          const deps = service.dependencyReport(row.manifest.id);
          heading(row.manifest.name);
          printUnifiedSkill(row, true);
          console.log(`\n  ${C.bold("Long description")}\n  ${(row.manifest.longDescription ?? row.manifest.description).replace(/\n/g, "\n  ")}`);
          console.log(`\n  ${C.bold("Permissions")}`);
          for (const p of [...(perms?.safe ?? []), ...(perms?.dangerous ?? [])]) console.log(`  - ${p.scope}${p.dangerous ? " !" : ""}: ${p.granted ? "granted" : "not granted"} — ${p.reason}`);
          if (!perms || (![...perms.safe, ...perms.dangerous].length)) console.log("  none");
          console.log(`\n  ${C.bold("Dependencies")}`);
          for (const d of deps.statuses) console.log(`  - ${d.dependency.kind}:${d.dependency.id} ${d.satisfied ? C.green("ok") : C.amber("missing")} — ${d.reason}`);
          if (!deps.statuses.length) console.log("  none");
          return;
        }

        case "install-local": {
          const dir = rest[0];
          if (!dir) { warn("usage: xr skills install-local <dir>"); return; }
          const grant = typeof flags.grant === "string" ? flags.grant.split(",").map((s) => s.trim()).filter(Boolean) as SkillPermissionScope[] : undefined;
          const entry = service.installLocal(dir, { grantPermissions: grant, force: boolFlag(flags, "force"), pin: boolFlag(flags, "pin") });
          ok(`installed local skill ${entry.id}@${entry.version}`);
          return;
        }

        case "install": {
          const source = rest[0];
          if (!source) { warn("provide skill id, directory, git URL, or .xrs package"); return; }
          const grant = typeof flags.grant === "string" ? flags.grant.split(",").map((s) => s.trim()).filter(Boolean) as SkillPermissionScope[] : undefined;
          const entry = service.install(source, { enable: !boolFlag(flags, "disable"), grantPermissions: grant, force: boolFlag(flags, "force"), pin: boolFlag(flags, "pin") });
          ok(`installed ${entry.id}@${entry.version}`);
          return;
        }

        case "update": {
          const id = rest[0];
          if (!id) { warn("provide skill id"); return; }
          const entry = service.update(id, { force: boolFlag(flags, "force") });
          ok(`updated ${entry.id}@${entry.version}`);
          return;
        }

        case "remove":
        case "uninstall": {
          const id = rest[0];
          if (!id) { warn("provide skill id"); return; }
          service.remove(id) ? ok(`removed ${id}`) : warn(`not installed: ${id}`);
          return;
        }

        case "enable":
        case "disable": {
          const id = rest[0];
          if (!id) { warn(`provide skill id to ${action}`); return; }
          action === "enable" ? service.enable(id) : service.disable(id);
          ok(`${action} ${id}`);
          return;
        }

        case "favorite":
        case "unfavorite":
        case "pin":
        case "unpin": {
          const id = rest[0];
          if (!id) { warn(`provide skill id to ${action}`); return; }
          if (action === "favorite") service.favorite(id, true);
          if (action === "unfavorite") service.favorite(id, false);
          if (action === "pin") service.pin(id, true);
          if (action === "unpin") service.pin(id, false);
          ok(`${action} ${id}`);
          return;
        }

        case "migrate": {
          const root = rest[0] ?? ctx.cwd;
          const result = service.migrate(root);
          heading("Skill Migration");
          console.log(`  scanned: ${result.scanned}`);
          console.log(`  migrated: ${result.migrated.length}`);
          for (const m of result.migrated) ok(`${m.id} -> ${m.file}`);
          if (result.skipped.length) {
            console.log(`  skipped: ${result.skipped.length}`);
            for (const s of result.skipped.slice(0, 20)) warn(`${s.dir}: ${s.reason}`);
          }
          return;
        }

        case "validate": {
          const dir = rest[0] ?? ctx.cwd;
          const result = service.validate(dir);
          for (const e of result.errors) error(e);
          for (const w of result.warnings) warn(w);
          result.ok ? ok(`valid skill: ${result.manifest?.id}`) : error("skill validation failed");
          return;
        }

        case "rollback": {
          const id = rest[0];
          if (!id) { warn("provide skill id"); return; }
          const entry = service.rollback(id, typeof flags.version === "string" ? flags.version : undefined);
          ok(`rolled back ${entry.id} to ${entry.version}`);
          return;
        }

        case "export": {
          const id = rest[0];
          if (!id) { warn("provide skill id"); return; }
          const out = service.export(id, typeof flags.out === "string" ? flags.out : undefined);
          ok(`exported ${id} to ${out}`);
          return;
        }

        case "import": {
          const file = rest[0];
          if (!file) { warn("provide .xrs package path"); return; }
          const entry = service.importPackage(file, { enable: !boolFlag(flags, "disable") });
          ok(`imported ${entry.id}@${entry.version}`);
          return;
        }

        case "create":
        case "init": {
          const name = rest.join(" ").trim() || "New XR Skill";
          const category = typeof flags.category === "string" && (SKILL_CATEGORIES as readonly string[]).includes(flags.category) ? flags.category as SkillCategory : "productivity";
          const dir = service.create({ name, id: typeof flags.id === "string" ? flags.id : undefined, category, publisher: typeof flags.publisher === "string" ? flags.publisher : undefined, dir: typeof flags.dir === "string" ? flags.dir : undefined, description: typeof flags.description === "string" ? flags.description : undefined });
          ok(`created skill at ${dir}`);
          tip(`next: xr skills validate ${dir}`);
          return;
        }

        case "package":
        case "build": {
          const dir = rest[0] ?? ctx.cwd;
          const out = service.package(dir, typeof flags.out === "string" ? flags.out : undefined);
          ok(`packaged skill: ${out}`);
          return;
        }

        case "publish": {
          const dir = rest[0] ?? ctx.cwd;
          const out = service.publish(dir, typeof flags["out-dir"] === "string" ? flags["out-dir"] : undefined);
          ok(`prepared publish package: ${out.packagePath}`);
          ok(`prepared metadata: ${out.manifestPath}`);
          return;
        }

        case "test": {
          const dir = rest[0] ?? ctx.cwd;
          const result = service.test(dir);
          for (const e of result.errors) error(e);
          for (const w of result.warnings) warn(w);
          result.ok ? ok("skill tests passed") : error("skill tests failed");
          return;
        }

        case "doctor": {
          const d = service.doctor();
          heading("XR 2.1A Skill Runtime Doctor");
          console.log(`  catalog total: ${d.total}`);
          console.log(`  catalog installed: ${d.installed}`);
          console.log(`  catalog enabled: ${d.enabled}`);
          console.log(`  official: ${d.official}`);
          console.log(`  runtime total: ${d.runtime.total}`);
          console.log(`  runtime enabled: ${d.runtime.enabled}`);
          console.log(`  runtime invalid: ${d.runtime.invalid}`);
          console.log(`  search index docs: ${d.runtime.index.documents}`);
          console.log(`  missing required deps: ${d.runtime.missingRequired.length}`);
          if (d.dangerous.length) for (const p of d.dangerous.slice(0, 30)) warn(`dangerous permission declared: ${p}`);
          if (d.runtime.missingRequired.length) for (const dep of d.runtime.missingRequired.slice(0, 30)) warn(`missing dependency: ${dep}`);
          return;
        }

        default:
          printUsage();
          return;
      }
    } catch (e) {
      error((e as Error).message);
    }
  }
}

export class SkillsAliasCommand extends SkillsCommand {
  name = "skills";
}
