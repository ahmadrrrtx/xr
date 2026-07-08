/**
 * XR Business OS — Integration Registry
 * 
 * Manages optional BYOK/OAuth/API integrations.
 * All integrations are opt-in. Users own their credentials.
 * No silent integrations. No hidden data collection.
 * 
 * Each connector is an XR Plugin or MCP Server.
 * This registry provides discovery, configuration, and health checking.
 */

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  category: 'communication' | 'calendar' | 'development' | 'storage' | 'crm_erp' | 'automation' | 'analytics' | 'payments' | 'commerce' | 'design' | 'infrastructure';
  icon: string;
  authType: 'oauth2' | 'api_key' | 'basic' | 'bearer' | 'none';
  scopes?: string[];
  configFields: ConnectorConfigField[];
  capabilities: string[];
  mcpServer?: string; // MCP server ID if using MCP
  pluginId?: string; // Plugin ID if using Plugin Platform
}

export interface ConnectorConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url' | 'select' | 'boolean';
  required: boolean;
  description?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

export interface InstalledConnector {
  id: string;
  connectorId: string;
  workspaceId: string;
  status: 'connected' | 'disconnected' | 'error' | 'expired';
  config: Record<string, unknown>;
  credentialRef: string;
  connectedAt?: string;
  lastSyncAt?: string;
  error?: string;
}

// ─── CONNECTOR DEFINITIONS ───

export const CONNECTORS: ConnectorDefinition[] = [
  // Communication
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Send and receive emails through Gmail',
    category: 'communication',
    icon: '📧',
    authType: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
    configFields: [],
    capabilities: ['send_email', 'read_email', 'search_email'],
  },
  {
    id: 'outlook',
    name: 'Microsoft Outlook',
    description: 'Send and receive emails through Outlook',
    category: 'communication',
    icon: '📬',
    authType: 'oauth2',
    scopes: ['Mail.Read', 'Mail.Send', 'Mail.ReadWrite'],
    configFields: [],
    capabilities: ['send_email', 'read_email', 'search_email'],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages and manage channels in Slack',
    category: 'communication',
    icon: '💬',
    authType: 'oauth2',
    scopes: ['chat:write', 'channels:read', 'channels:history'],
    configFields: [],
    capabilities: ['send_message', 'read_channels', 'manage_channels'],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Send messages and manage servers in Discord',
    category: 'communication',
    icon: '🎮',
    authType: 'bot_token',
    configFields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
      { key: 'guildId', label: 'Server ID', type: 'text', required: true },
    ],
    capabilities: ['send_message', 'read_channels'],
  },
  {
    id: 'microsoft_teams',
    name: 'Microsoft Teams',
    description: 'Collaborate through Microsoft Teams',
    category: 'communication',
    icon: '👥',
    authType: 'oauth2',
    scopes: ['Chat.ReadWrite', 'Team.ReadBasic.All'],
    configFields: [],
    capabilities: ['send_message', 'read_chats'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Send messages through Telegram Bot API',
    category: 'communication',
    icon: '✈️',
    authType: 'api_key',
    configFields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
      { key: 'chatId', label: 'Chat ID', type: 'text', required: false },
    ],
    capabilities: ['send_message', 'read_messages'],
  },
  {
    id: 'whatsapp_business',
    name: 'WhatsApp Business',
    description: 'Send messages through WhatsApp Business API',
    category: 'communication',
    icon: '📱',
    authType: 'bearer',
    configFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true },
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true },
    ],
    capabilities: ['send_message', 'read_messages'],
  },

  // Calendar
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    description: 'Sync events with Google Calendar',
    category: 'calendar',
    icon: '📅',
    authType: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/calendar'],
    configFields: [],
    capabilities: ['create_event', 'read_events', 'update_event', 'delete_event'],
  },
  {
    id: 'outlook_calendar',
    name: 'Outlook Calendar',
    description: 'Sync events with Outlook Calendar',
    category: 'calendar',
    icon: '📆',
    authType: 'oauth2',
    scopes: ['Calendars.ReadWrite'],
    configFields: [],
    capabilities: ['create_event', 'read_events', 'update_event', 'delete_event'],
  },
  {
    id: 'cal_com',
    name: 'Cal.com',
    description: 'Manage scheduling through Cal.com',
    category: 'calendar',
    icon: '🕐',
    authType: 'api_key',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    capabilities: ['create_booking', 'read_bookings', 'manage_availability'],
  },

  // Development
  {
    id: 'github',
    name: 'GitHub',
    description: 'Manage repositories, issues, and pull requests',
    category: 'development',
    icon: '🐙',
    authType: 'oauth2',
    scopes: ['repo', 'read:org'],
    configFields: [],
    capabilities: ['read_repos', 'create_issue', 'read_issues', 'create_pr'],
    pluginId: 'github',
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Manage repositories and merge requests',
    category: 'development',
    icon: '🦊',
    authType: 'oauth2',
    scopes: ['api'],
    configFields: [],
    capabilities: ['read_repos', 'create_issue', 'create_mr'],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Manage issues and sprints in Jira',
    category: 'development',
    icon: '🔵',
    authType: 'oauth2',
    configFields: [
      { key: 'domain', label: 'Domain', type: 'url', required: true, description: 'e.g., yourteam.atlassian.net' },
    ],
    capabilities: ['create_issue', 'read_issues', 'update_issue', 'manage_sprints'],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage issues and projects in Linear',
    category: 'development',
    icon: '⬜',
    authType: 'api_key',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    capabilities: ['create_issue', 'read_issues', 'update_issue'],
  },

  // Storage
  {
    id: 'google_drive',
    name: 'Google Drive',
    description: 'Store and manage files in Google Drive',
    category: 'storage',
    icon: '📁',
    authType: 'oauth2',
    scopes: ['https://www.googleapis.com/auth/drive'],
    configFields: [],
    capabilities: ['upload_file', 'download_file', 'list_files', 'share_file'],
  },
  {
    id: 'onedrive',
    name: 'OneDrive',
    description: 'Store and manage files in OneDrive',
    category: 'storage',
    icon: '☁️',
    authType: 'oauth2',
    scopes: ['Files.ReadWrite'],
    configFields: [],
    capabilities: ['upload_file', 'download_file', 'list_files'],
  },
  {
    id: 'dropbox',
    name: 'Dropbox',
    description: 'Store and manage files in Dropbox',
    category: 'storage',
    icon: '📦',
    authType: 'oauth2',
    configFields: [],
    capabilities: ['upload_file', 'download_file', 'list_files'],
  },
  {
    id: 'nextcloud',
    name: 'Nextcloud',
    description: 'Self-hosted file storage',
    category: 'storage',
    icon: '🌤️',
    authType: 'basic',
    configFields: [
      { key: 'url', label: 'Server URL', type: 'url', required: true },
      { key: 'username', label: 'Username', type: 'text', required: true },
      { key: 'password', label: 'Password', type: 'password', required: true },
    ],
    capabilities: ['upload_file', 'download_file', 'list_files'],
  },

  // CRM/ERP
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Sync contacts and deals with HubSpot CRM',
    category: 'crm_erp',
    icon: '🟠',
    authType: 'oauth2',
    scopes: ['contacts', 'deals', 'companies'],
    configFields: [],
    capabilities: ['sync_contacts', 'sync_deals', 'sync_companies'],
    mcpServer: 'hubspot',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Sync with Salesforce CRM',
    category: 'crm_erp',
    icon: '☁️',
    authType: 'oauth2',
    scopes: ['api', 'refresh_token'],
    configFields: [],
    capabilities: ['sync_contacts', 'sync_opportunities', 'sync_accounts'],
    mcpServer: 'salesforce',
  },
  {
    id: 'erpnext',
    name: 'ERPNext',
    description: 'Sync with ERPNext ERP system',
    category: 'crm_erp',
    icon: '🏗️',
    authType: 'api_key',
    configFields: [
      { key: 'url', label: 'Instance URL', type: 'url', required: true },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
    ],
    capabilities: ['sync_contacts', 'sync_invoices', 'sync_items'],
  },
  {
    id: 'twenty',
    name: 'Twenty',
    description: 'Sync with Twenty CRM',
    category: 'crm_erp',
    icon: '2️⃣',
    authType: 'api_key',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    capabilities: ['sync_contacts', 'sync_companies', 'sync_opportunities'],
  },

  // Payments
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Process payments and manage subscriptions',
    category: 'payments',
    icon: '💳',
    authType: 'api_key',
    configFields: [
      { key: 'secretKey', label: 'Secret Key', type: 'password', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret', type: 'password', required: false },
    ],
    capabilities: ['create_payment', 'read_payments', 'manage_subscriptions'],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    description: 'Process payments through PayPal',
    category: 'payments',
    icon: '🅿️',
    authType: 'oauth2',
    configFields: [],
    capabilities: ['create_payment', 'read_payments'],
  },

  // Analytics
  {
    id: 'plausible',
    name: 'Plausible',
    description: 'Privacy-first web analytics',
    category: 'analytics',
    icon: '📊',
    authType: 'api_key',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'siteId', label: 'Site ID', type: 'text', required: true },
    ],
    capabilities: ['read_stats', 'read_visitors', 'read_pages'],
  },
  {
    id: 'posthog',
    name: 'PostHog',
    description: 'Product analytics and feature flags',
    category: 'analytics',
    icon: '🦔',
    authType: 'api_key',
    configFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'host', label: 'Host URL', type: 'url', required: false, defaultValue: 'https://app.posthog.com' },
    ],
    capabilities: ['read_events', 'read_insights', 'manage_flags'],
  },

  // Commerce
  {
    id: 'shopify',
    name: 'Shopify',
    description: 'Manage Shopify store',
    category: 'commerce',
    icon: '🛒',
    authType: 'oauth2',
    configFields: [],
    capabilities: ['read_orders', 'read_products', 'manage_inventory'],
  },
  {
    id: 'woocommerce',
    name: 'WooCommerce',
    description: 'Manage WooCommerce store',
    category: 'commerce',
    icon: '🛍️',
    authType: 'api_key',
    configFields: [
      { key: 'url', label: 'Store URL', type: 'url', required: true },
      { key: 'consumerKey', label: 'Consumer Key', type: 'password', required: true },
      { key: 'consumerSecret', label: 'Consumer Secret', type: 'password', required: true },
    ],
    capabilities: ['read_orders', 'read_products', 'manage_inventory'],
  },

  // Automation
  {
    id: 'n8n',
    name: 'n8n',
    description: 'Trigger and manage n8n workflows',
    category: 'automation',
    icon: '🔄',
    authType: 'api_key',
    configFields: [
      { key: 'url', label: 'Instance URL', type: 'url', required: true },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    capabilities: ['trigger_workflow', 'read_executions'],
  },
  {
    id: 'activepieces',
    name: 'Activepieces',
    description: 'Trigger and manage Activepieces flows',
    category: 'automation',
    icon: '⚡',
    authType: 'api_key',
    configFields: [
      { key: 'url', label: 'Instance URL', type: 'url', required: true },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    capabilities: ['trigger_flow', 'read_runs'],
  },

  // Infrastructure
  {
    id: 'coolify',
    name: 'Coolify',
    description: 'Manage self-hosted infrastructure',
    category: 'infrastructure',
    icon: '🧊',
    authType: 'api_key',
    configFields: [
      { key: 'url', label: 'Instance URL', type: 'url', required: true },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    capabilities: ['read_deployments', 'manage_services'],
  },
  {
    id: 'docker',
    name: 'Docker',
    description: 'Manage Docker containers',
    category: 'infrastructure',
    icon: '🐳',
    authType: 'none',
    configFields: [
      { key: 'host', label: 'Docker Host', type: 'url', required: false, defaultValue: 'unix:///var/run/docker.sock' },
    ],
    capabilities: ['list_containers', 'manage_containers'],
  },
];

// ─── CONNECTOR REGISTRY ───

export class ConnectorRegistry {
  private connectors = new Map<string, ConnectorDefinition>();
  private installed = new Map<string, InstalledConnector>();

  constructor() {
    // Register all built-in connectors
    for (const connector of CONNECTORS) {
      this.connectors.set(connector.id, connector);
    }
  }

  /**
   * Get a connector definition.
   */
  get(id: string): ConnectorDefinition | undefined {
    return this.connectors.get(id);
  }

  /**
   * List all available connectors.
   */
  list(category?: string): ConnectorDefinition[] {
    const all = Array.from(this.connectors.values());
    return category ? all.filter(c => c.category === category) : all;
  }

  /**
   * List categories.
   */
  categories(): string[] {
    return [...new Set(Array.from(this.connectors.values()).map(c => c.category))];
  }

  /**
   * Install a connector for a workspace.
   */
  install(workspaceId: string, connectorId: string, config: Record<string, unknown>, credentialRef: string): InstalledConnector {
    const def = this.connectors.get(connectorId);
    if (!def) throw new Error(`Connector "${connectorId}" not found`);

    // Validate required fields
    for (const field of def.configFields) {
      if (field.required && !config[field.key]) {
        throw new Error(`Required field "${field.label}" is missing`);
      }
    }

    const installed: InstalledConnector = {
      id: crypto.randomUUID(),
      connectorId,
      workspaceId,
      status: 'connected',
      config,
      credentialRef,
      connectedAt: new Date().toISOString(),
    };

    this.installed.set(installed.id, installed);
    return installed;
  }

  /**
   * List installed connectors for a workspace.
   */
  listInstalled(workspaceId: string): InstalledConnector[] {
    return Array.from(this.installed.values()).filter(i => i.workspaceId === workspaceId);
  }

  /**
   * Uninstall a connector.
   */
  uninstall(installedId: string): boolean {
    return this.installed.delete(installedId);
  }
}
