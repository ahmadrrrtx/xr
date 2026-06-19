Skip to content
ahmadrrrtx
xr
Repository navigation
Code
Issues
Pull requests
Agents
Actions
Projects
Wiki
Security and quality
Insights
Settings
Files
Go to file
t
T
config content loaded
assets
bin
docs
extensions
plugins
scripts
skills
src
automation
commands
budget.ts
config.ts
doctor.ts
help.ts
install.ts
memory.ts
providers.ts
run-agent.ts
computer
config
config.ts
control
core
cost
daemon
export
i18n
install
interfaces
local
mcp
memory
plugins
providers
reliability
research
security
services
skills
state
telegram
tools
ui
update
voice
index.ts
test
website
Dockerfile
LAUNCH-POSTS.md
LICENSE
MIGRATION.md
README.md
bun.lock
docker-compose.yml
gitignore
install.ps1
install.sh
package.json
tsconfig.json
xr/src
/
index.ts
in
main

Edit

Preview
Indent mode

Spaces
Indent size

2
Line wrap mode

No wrap
Editing index.ts file contents
  1
  2
  3
  4
  5
  6
  7
  8
  9
 10
 11
 12
 13
 14
 15
 16
 17
 18
 19
 20
 21
 22
 23
 24
 25
 26
 27
 28
 29
 30
 31
 32
 33
 34
 35
 36
#!/usr/bin/env bun
/**
 * XR — The AI Agent You Can Actually Trust
 * Stage 3 CLI bootstrap.
 */

import { XRRuntime } from "./core/runtime.ts";
import { RunAgentCommand } from "./commands/run-agent.ts";
import { DoctorCommand } from "./commands/doctor.ts";
import { ConfigCommand } from "./commands/config.ts";
import { BudgetCommand } from "./commands/budget.ts";
import { ProvidersCommand } from "./commands/providers.ts";
import { MemoryCommand } from "./commands/memory.ts";
import {
  ControlCommand,
  InstallCommand,
  ModelsCommand,
  OnboardingCommand,
  RepairCommand,
  ResearchCommand,
  ResetCommand,
  StatusCommand,
  UpdateCommand,
  VoiceCommand,
} from "./commands/install.ts";
import { ConfigService } from "./services/config-service.ts";
import { ProviderService } from "./services/provider-service.ts";
import { AgentService } from "./services/agent-service.ts";
import { BudgetService } from "./services/budget-service.ts";
import { PluginService } from "./services/plugin-service.ts";
import { Store } from "./state/db.ts";
import { SessionStore } from "./state/stores/session-store.ts";
import { AuditStore } from "./state/stores/audit-store.ts";
import { MemoryStore } from "./state/stores/memory-store.ts";
import { CostStore } from "./state/stores/cost-store.ts";
import { UserMemoryStore } from "./state/stores/user-memory-store.ts";
Use Control + Shift + m to toggle the tab key moving focus. Alternatively, use esc then tab to move to the next interactive element on the page.
 
config content loaded
