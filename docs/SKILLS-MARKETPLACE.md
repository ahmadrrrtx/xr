# XR Stage 13 — Skills Marketplace

XR Skills make XR smarter without requiring users to write code. A Skill is a professional capability package, not just a prompt. It can declare instructions, reasoning policy, knowledge, tools, MCP requirements, plugins, workflows, voice intents, UI panels, slash commands, tests, examples, memory templates, settings, dependencies, permissions, and documentation.

## Commands

```bash
xr skill browse
xr skill search react performance
xr skill info react_expert
xr skill install react_expert
xr skill disable react_expert
xr skill enable react_expert
xr skill favorite react_expert
xr skill export react_expert
xr skill create "Contract Reviewer" --category business --publisher you
xr skill validate ./contract-reviewer
xr skill package ./contract-reviewer
xr skill publish ./contract-reviewer
xr skill test ./contract-reviewer
xr skill doctor
```

## Skill structure

```text
my-skill/
  xr-skill.json        # complete XR manifest
  SKILL.md             # primary instructions
  README.md            # user-facing docs
  docs/reasoning.md    # reasoning policy
  knowledge/*.md       # references
  templates/*.md       # prompt/output templates
  examples/*.md        # examples
  tests/*.md           # validation scenarios
  assets/*             # optional assets
```

## Runtime behavior

1. XR scans bundled and installed skills.
2. XR builds a compact skill index from IDs, names, descriptions, categories, tags, triggers, and verification metadata.
3. For each user task, XR ranks enabled skills and progressively loads only the most relevant full instructions.
4. XR injects selected Skill context into the system prompt while preserving core safety, budget, memory, egress, and approval policies.
5. Skill permissions remain declarations, not automatic authority. Dangerous actions still require approval through XR tools.

## Security model

Every Skill declares permissions with a reason. Dangerous permissions include filesystem writes, network, browser, provider use, MCP, voice, computer control, secrets, shell, publishing, workflow execution, and analytics writes. XR keeps these permissions auditable and never lets a Skill silently bypass core safeguards.

## Publishing model

`xr skill publish` creates a package and marketplace metadata in the local outbox. This keeps publishing transparent and reviewable before sync to any hosted registry. `xr skill package` produces a `.xrs` package with a tree checksum; import verifies the checksum before installation.
