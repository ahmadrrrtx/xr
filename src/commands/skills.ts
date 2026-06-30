/** XR Stage 13 — Skills Marketplace CLI. */
import { Command, CommandContext } from "../core/command-registry.ts";
import { SkillService } from "../services/skill-service.ts";
import { colors as C, heading, ok, warn, error, tip } from "../interfaces/cli.ts";
import { SKILL_CATEGORIES, type SkillCategory, type SkillPermissionScope } from "../skills/schema.ts";

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

function printSkill(row: ReturnType<SkillService["catalog"]>[number], verbose = false): void {
  const m = row.manifest;
  const badges = [
    row.enabled ? C.green("enabled") : C.dim("disabled"),
    m.verification.level === "official" || m.verification.level === "verified" ? C.cyan(m.verification.level) : C.dim(m.verification.level),
    row.favorite ? C.amber("★") : "",
    row.pinned ? C.amber("pinned") : "",
  ].filter(Boolean).join(" ");
  console.log(`  ${C.bold(m.id)} ${C.dim(`v${m.version}`)} ${badges}`);
  console.log(`    ${m.description}`);
  console.log(`    ${C.dim(m.categories.join(" / "))}  ${m.tags.slice(0, 8).map((t) => `#${t}`).join(" ")}`);
  if (verbose) {
    console.log(`    publisher: ${m.publisher}  permissions: ${m.permissions.map((p) => p.scope).join(", ") || "none"}`);
    console.log(`    commands: ${m.contributions.commands.map((c) => c.name).join(", ") || "none"}`);
    console.log(`    voice: ${m.contributions.voiceIntents.map((v) => v.id).join(", ") || "none"}`);
    console.log(`    mcp: ${m.mcp.map((x) => x.id).join(", ") || "none"}`);
  }
}

function printUsage(): void {
  heading("XR Skills Marketplace");
  console.log("  xr skill browse [--category developer] [--verified]");
  console.log("  xr skill search <query> [--category security] [--tag react]");
  console.log("  xr skill info <id>");
  console.log("  xr skill install <id|dir|git-url|package.xrs> [--enable] [--pin] [--grant fs:read,net]");
  console.log("  xr skill update <id> [--force]");
  console.log("  xr skill remove <id>");
  console.log("  xr skill enable|disable <id>");
  console.log("  xr skill favorite|unfavorite <id>");
  console.log("  xr skill pin|unpin <id>");
  console.log("  xr skill rollback <id> [--version 1.2.3]");
  console.log("  xr skill create <name> [--id slug] [--category developer] [--publisher you] [--dir path]");
  console.log("  xr skill validate <dir>");
  console.log("  xr skill package <dir> [--out file.xrs]");
  console.log("  xr skill publish <dir> [--out-dir dir]");
  console.log("  xr skill test <dir>");
  console.log("  xr skill recommend <task>");
  console.log("  xr skill doctor");
}

export class SkillsCommand implements Command {
  name = "skill";
  description = "browse, install, run, and develop XR Skills";
  usage = "xr skill <browse|search|info|install|update|remove|enable|disable|create|validate|package|publish|test|doctor>";

  async execute(ctx: CommandContext): Promise<void> {
    const service = ctx.container.resolve<SkillService>("skills");
    const parsed = parse(ctx.args);
    const action = parsed.positional[0] ?? "browse";
    const rest = parsed.positional.slice(1);
    const flags = parsed.flags;

    try {
      switch (action) {
        case "help":
        case "--help":
          printUsage();
          return;

        case "browse":
        case "list":
        case "marketplace": {
          const rows = service.search({
            category: typeof flags.category === "string" ? flags.category : undefined,
            tag: typeof flags.tag === "string" ? flags.tag : undefined,
            installed: boolFlag(flags, "installed") ? true : undefined,
            enabled: boolFlag(flags, "enabled") ? true : undefined,
            verified: boolFlag(flags, "verified"),
            limit: typeof flags.limit === "string" ? Number(flags.limit) : 80,
          });
          heading(`Skills (${rows.length})`);
          for (const row of rows) printSkill(row, boolFlag(flags, "verbose"));
          return;
        }

        case "installed": {
          const rows = service.search({ installed: true, limit: 200 });
          heading(`Installed Skills (${rows.length})`);
          for (const row of rows) printSkill(row, boolFlag(flags, "verbose"));
          return;
        }

        case "search": {
          const query = rest.join(" ").trim();
          if (!query) { warn("provide a search query"); return; }
          const rows = service.search({ query, category: typeof flags.category === "string" ? flags.category : undefined, tag: typeof flags.tag === "string" ? flags.tag : undefined, limit: typeof flags.limit === "string" ? Number(flags.limit) : 20 });
          heading(`Search: ${query}`);
          for (const row of rows) printSkill(row, boolFlag(flags, "verbose"));
          return;
        }

        case "recommend": {
          const task = rest.join(" ").trim();
          if (!task) { warn("provide a task to recommend skills for"); return; }
          const rows = service.recommendations(task, typeof flags.limit === "string" ? Number(flags.limit) : 8);
          heading("Recommended Skills");
          for (const row of rows) printSkill(row, true);
          return;
        }

        case "info":
        case "show": {
          const id = rest[0];
          if (!id) { warn("provide a skill id"); return; }
          const row = service.get(id);
          if (!row) { error(`skill not found: ${id}`); return; }
          heading(row.manifest.name);
          printSkill(row, true);
          console.log(`\n  ${C.bold("Long description")}\n  ${(row.manifest.longDescription ?? row.manifest.description).replace(/\n/g, "\n  ")}`);
          const similar = service.similar(row.manifest.id, 5);
          if (similar.length) {
            console.log(`\n  ${C.bold("Similar")}`);
            for (const s of similar) console.log(`  - ${s.manifest.id}: ${s.manifest.name}`);
          }
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
        case "disable":
        case "favorite":
        case "unfavorite":
        case "pin":
        case "unpin": {
          const id = rest[0];
          if (!id) { warn(`provide skill id to ${action}`); return; }
          if (action === "enable") service.enable(id);
          if (action === "disable") service.disable(id);
          if (action === "favorite") service.favorite(id, true);
          if (action === "unfavorite") service.favorite(id, false);
          if (action === "pin") service.pin(id, true);
          if (action === "unpin") service.pin(id, false);
          ok(`${action} ${id}`);
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

        case "create": {
          const name = rest.join(" ").trim();
          if (!name) { warn("provide skill name"); return; }
          const category = typeof flags.category === "string" && (SKILL_CATEGORIES as readonly string[]).includes(flags.category) ? flags.category as SkillCategory : "productivity";
          const dir = service.create({ name, id: typeof flags.id === "string" ? flags.id : undefined, category, publisher: typeof flags.publisher === "string" ? flags.publisher : undefined, dir: typeof flags.dir === "string" ? flags.dir : undefined, description: typeof flags.description === "string" ? flags.description : undefined });
          ok(`created skill at ${dir}`);
          tip(`next: xr skill validate ${dir}`);
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

        case "package": {
          const dir = rest[0] ?? ctx.cwd;
          const out = service.package(dir, typeof flags.out === "string" ? flags.out : undefined);
          ok(`packaged skill: ${out}`);
          return;
        }

        case "publish": {
          const dir = rest[0] ?? ctx.cwd;
          const out = service.publish(dir, typeof flags["out-dir"] === "string" ? flags["out-dir"] : undefined);
          ok(`prepared publish package: ${out.packagePath}`);
          ok(`prepared marketplace metadata: ${out.manifestPath}`);
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
          heading("Skill Marketplace Doctor");
          console.log(`  total: ${d.total}`);
          console.log(`  installed: ${d.installed}`);
          console.log(`  enabled: ${d.enabled}`);
          console.log(`  official: ${d.official}`);
          console.log(`  dangerous permissions: ${d.dangerous.length}`);
          if (d.dangerous.length) for (const p of d.dangerous) warn(p);
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
