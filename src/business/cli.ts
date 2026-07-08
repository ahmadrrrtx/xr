/**
 * XR Business OS — CLI Commands
 * 
 * Registers `xr biz` commands with XR's existing command registry.
 * Integrates with XR CLI and TUI.
 */

export const BUSINESS_CLI_COMMANDS = {
  // ─── INIT & CONFIG ───
  'biz': {
    description: 'XR Business OS commands',
    subcommands: {
      'init': {
        description: 'Initialize Business OS in current workspace',
        usage: 'xr biz init [--org <name>] [--workspace <name>]',
        handler: 'initBusinessOS',
      },
      'status': {
        description: 'Show Business OS status',
        usage: 'xr biz status',
        handler: 'showStatus',
      },
      'enable': {
        description: 'Enable Business OS modules',
        usage: 'xr biz enable <module1,module2,...>',
        handler: 'enableModules',
      },
      'disable': {
        description: 'Disable Business OS modules',
        usage: 'xr biz disable <module1,module2,...>',
        handler: 'disableModules',
      },

      // ─── CRM ───
      'contacts': {
        description: 'Manage contacts',
        usage: 'xr biz contacts [list|add|show|update|delete|search]',
        subcommands: {
          'list': { description: 'List contacts', handler: 'listContacts' },
          'add': { description: 'Add a contact', usage: 'xr biz contacts add --name <name> [--email <email>] [--company <company>]', handler: 'addContact' },
          'show': { description: 'Show contact details', usage: 'xr biz contacts show <id>', handler: 'showContact' },
          'update': { description: 'Update a contact', handler: 'updateContact' },
          'delete': { description: 'Delete a contact', handler: 'deleteContact' },
          'search': { description: 'Search contacts', usage: 'xr biz contacts search <query>', handler: 'searchContacts' },
        },
      },

      // ─── SALES ───
      'deals': {
        description: 'Manage deals',
        usage: 'xr biz deals [list|add|show|move|forecast]',
        subcommands: {
          'list': { description: 'List deals', handler: 'listDeals' },
          'add': { description: 'Add a deal', handler: 'addDeal' },
          'show': { description: 'Show deal details', handler: 'showDeal' },
          'move': { description: 'Move deal to a stage', handler: 'moveDeal' },
          'forecast': { description: 'Show sales forecast', handler: 'showForecast' },
        },
      },

      // ─── SUPPORT ───
      'tickets': {
        description: 'Manage support tickets',
        usage: 'xr biz tickets [list|add|show|resolve]',
        subcommands: {
          'list': { description: 'List tickets', handler: 'listTickets' },
          'add': { description: 'Create a ticket', handler: 'addTicket' },
          'show': { description: 'Show ticket details', handler: 'showTicket' },
          'resolve': { description: 'Resolve a ticket', handler: 'resolveTicket' },
        },
      },

      // ─── PROJECTS ───
      'projects': {
        description: 'Manage projects',
        usage: 'xr biz projects [list|add|show|tasks]',
        subcommands: {
          'list': { description: 'List projects', handler: 'listProjects' },
          'add': { description: 'Create a project', handler: 'addProject' },
          'show': { description: 'Show project details', handler: 'showProject' },
          'tasks': { description: 'List project tasks', handler: 'listProjectTasks' },
        },
      },
      'tasks': {
        description: 'Manage tasks',
        usage: 'xr biz tasks [list|add|update]',
        subcommands: {
          'list': { description: 'List tasks', handler: 'listTasks' },
          'add': { description: 'Add a task', handler: 'addTask' },
          'update': { description: 'Update task status', handler: 'updateTask' },
        },
      },

      // ─── KNOWLEDGE ───
      'kb': {
        description: 'Knowledge base management',
        usage: 'xr biz kb [list|add|search]',
        subcommands: {
          'list': { description: 'List articles', handler: 'listArticles' },
          'add': { description: 'Create an article', handler: 'addArticle' },
          'search': { description: 'Search articles', handler: 'searchArticles' },
        },
      },

      // ─── FINANCE ───
      'invoices': {
        description: 'Manage invoices',
        usage: 'xr biz invoices [list|add|show|send]',
        subcommands: {
          'list': { description: 'List invoices', handler: 'listInvoices' },
          'add': { description: 'Create an invoice', handler: 'addInvoice' },
          'show': { description: 'Show invoice', handler: 'showInvoice' },
          'send': { description: 'Send an invoice', handler: 'sendInvoice' },
        },
      },

      // ─── ANALYTICS ───
      'kpis': {
        description: 'Show business KPIs',
        usage: 'xr biz kpis',
        handler: 'showKPIs',
      },

      // ─── AUTOMATION ───
      'automations': {
        description: 'Manage automations',
        usage: 'xr biz automations [list|add|run]',
        subcommands: {
          'list': { description: 'List automations', handler: 'listAutomations' },
          'add': { description: 'Create automation', handler: 'addAutomation' },
          'run': { description: 'Run an automation', handler: 'runAutomation' },
        },
      },

      // ─── AI WORKERS ───
      'workers': {
        description: 'Manage AI Workers',
        usage: 'xr biz workers [list|deploy|chat]',
        subcommands: {
          'list': { description: 'List workers', handler: 'listWorkers' },
          'deploy': { description: 'Deploy a worker', usage: 'xr biz workers deploy <role>', handler: 'deployWorker' },
          'chat': { description: 'Chat with a worker', usage: 'xr biz workers chat <id> <message>', handler: 'chatWorker' },
        },
      },

      // ─── INTEGRATIONS ───
      'connect': {
        description: 'Connect an integration',
        usage: 'xr biz connect <connector-id>',
        handler: 'connectIntegration',
      },
      'disconnect': {
        description: 'Disconnect an integration',
        usage: 'xr biz disconnect <installed-id>',
        handler: 'disconnectIntegration',
      },
      'integrations': {
        description: 'List integrations',
        usage: 'xr biz integrations [available|connected]',
        subcommands: {
          'available': { description: 'List available integrations', handler: 'listAvailableIntegrations' },
          'connected': { description: 'List connected integrations', handler: 'listConnectedIntegrations' },
        },
      },

      // ─── SECURITY ───
      'audit': {
        description: 'View audit log',
        usage: 'xr biz audit [--resource <type>] [--limit <n>]',
        handler: 'showAuditLog',
      },
      'verify': {
        description: 'Verify audit chain integrity',
        usage: 'xr biz verify',
        handler: 'verifyAuditChain',
      },
    },
  },
};

export const BUSINESS_MODULE_IDS = [
  'crm', 'sales', 'marketing', 'support', 'projects', 'knowledge',
  'finance', 'hr', 'analytics', 'automation', 'scheduling',
  'communication', 'documents', 'meetings', 'ai-workers',
] as const;
