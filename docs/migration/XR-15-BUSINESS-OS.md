# XR Business OS — Migration Guide

## From XR Stage 14 to Stage 15

### Zero Breaking Changes

Business OS is **fully additive**. No existing XR functionality is modified, removed, or broken. All existing features, commands, skills, plugins, and MCP servers continue to work exactly as before.

### What's New

XR Stage 15 adds the following **new capabilities** to XR:

| Feature | Type | Description |
|---------|------|-------------|
| `BusinessOS` class | Module | Main entry point for all business features |
| 15 Business Modules | Module | CRM, Sales, Marketing, Support, Projects, Knowledge, Finance, HR, Analytics, Automation, Scheduling, Communication, Documents, Meetings, AI Workers |
| 11 AI Workers | Agent | Specialized business roles as XR Agents |
| 30+ Integrations | Plugin/MCP | Optional BYOK connections to external services |
| 12 Automation Templates | Skill | Pre-built workflow templates |
| Security Policies | Shield | Business-specific security enforcement |
| Audit Trail | Shield | SHA-256 hash chain for all business operations |
| `xr biz` Commands | CLI | New CLI commands for all business operations |

### Installation

Business OS is a built-in module of XR 15. No separate installation is needed.

```bash
# Update XR to Stage 15
xr update

# Initialize Business OS
xr biz init

# Enable specific modules
xr biz enable crm,sales,support,analytics

# Or enable all modules
xr biz enable all
```

### Step-by-Step Migration

#### 1. Update XR

```bash
# If installed via npm
npm update -g @rrrtx/xr

# If installed via install script
curl -fsSL https://raw.githubusercontent.com/ahmadrrrtx/xr/main/install.sh | bash
```

#### 2. Initialize Business OS

```bash
xr biz init
```

This command:
- Creates the `biz_*` tables in your existing XR SQLite database
- Creates a default organization
- Creates a default workspace
- Sets you as the owner
- Records schema version for future migrations

**Your existing XR data is NOT modified.**

#### 3. Enable Modules

```bash
# Enable all modules at once
xr biz enable all

# Or enable specific modules
xr biz enable crm,sales,support

# Disable a module
xr biz disable marketing
```

#### 4. Deploy AI Workers

```bash
# Deploy all default workers
xr biz workers deploy --all

# Deploy a specific worker
xr biz workers deploy sales-director

# List deployed workers
xr biz workers list
```

#### 5. Connect Integrations

```bash
# List available integrations
xr biz integrations available

# Connect an integration (starts OAuth or asks for API key)
xr biz connect gmail
xr biz connect slack
xr biz connect stripe

# List connected integrations
xr biz integrations connected

# Disconnect an integration
xr biz disconnect <installed-id>
```

#### 6. Import Existing Data (Optional)

If you have existing data in other CRMs or tools:

```bash
# Import contacts from CSV
xr biz contacts import --file contacts.csv

# Import from HubSpot (if connected)
xr biz contacts import --source hubspot

# Import from Twenty (if connected)
xr biz contacts import --source twenty
```

### Database Schema

Business OS adds tables with the `biz_` prefix. Your existing XR tables (`memory_entries`, `audit_log`, `skills`, etc.) are **never modified**.

**New tables created:**
- `biz_organizations` — Top-level tenants
- `biz_workspaces` — Team/project scopes
- `biz_members` — Users with roles
- `biz_contacts` — CRM contacts
- `biz_contact_notes` — Contact notes
- `biz_contact_activities` — Activity log
- `biz_pipelines` — Sales pipelines
- `biz_deals` — Sales deals
- `biz_projects` — Projects
- `biz_tasks` — Tasks
- `biz_milestones` — Milestones
- `biz_tickets` — Support tickets
- `biz_ticket_messages` — Ticket messages
- `biz_knowledge_articles` — KB articles
- `biz_invoices` — Invoices
- `biz_expenses` — Expenses
- `biz_employees` — Employee records
- `biz_time_off` — Time-off requests
- `biz_meetings` — Meetings
- `biz_calendar_events` — Calendar events
- `biz_documents` — Documents
- `biz_document_templates` — Templates
- `biz_automations` — Automations
- `biz_automation_runs` — Automation run history
- `biz_workers` — AI Workers
- `biz_worker_conversations` — Worker conversations
- `biz_dashboards` — Dashboards
- `biz_reports` — Reports
- `biz_audit` — Business audit trail
- `biz_events` — Business events
- `biz_credentials` — Encrypted credentials
- `biz_integration_sync` — Sync state
- `biz_schema_version` — Schema versioning

### Rollback

```bash
# Disable all Business OS modules (data preserved)
xr biz disable all

# Remove Business OS tables (PERMANENT — data lost)
xr biz uninstall --confirm
```

### Integration with Existing XR Features

| Existing Feature | How Business OS Uses It |
|-----------------|------------------------|
| `xr memory` | Business entities can be stored as memory entries |
| `xr research` | AI Workers use research for market analysis |
| `xr voice` | AI Workers support voice interaction |
| `xr control` | AI Workers can control computer |
| `xr plugins` | External integrations are XR Plugins |
| `xr mcp` | CRM/ERP integrations use MCP servers |
| `xr skills` | Business modules register as XR Skills |
| `xr shield` | Business operations pass through Shield |
| `xr serve` | Business dashboard served via daemon |
| `xr --tui` | Business context available in TUI |

### Troubleshooting

**Q: `xr biz init` fails with "table already exists"**
A: Safe to ignore. Business OS initialization is idempotent. Run `xr biz status` to verify.

**Q: AI Workers aren't responding**
A: Ensure you have a provider configured (`xr providers list`) or Ollama running (`ollama list`).

**Q: Integrations show "expired" status**
A: Re-authorize: `xr biz connect <connector-id>`

**Q: How do I check data integrity?**
A: Run `xr biz verify` to check the SHA-256 audit chain.

### Support

- GitHub: https://github.com/ahmadrrrtx/xr
- Issues: https://github.com/ahmadrrrtx/xr/issues
