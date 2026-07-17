/**
 * XR Business OS — Communication Module
 * 
 * Email, chat, notifications, and messaging.
 * 
 * Integrates with:
 * - Plugin Platform: Gmail, Slack, Discord, Teams, Telegram, WhatsApp
 * - AI Workers: Send messages on behalf of workers
 * - Automation: Notification workflows
 * - Contacts: Communication history
 */

import type { BusinessDatabase } from '../../core/database.ts';
import type { BusinessEventBus } from '../../core/bus.ts';

export interface Message {
  id: string;
  workspaceId: string;
  channel: 'email' | 'slack' | 'discord' | 'teams' | 'telegram' | 'whatsapp' | 'internal';
  from: { id: string; name: string; type: 'member' | 'worker' | 'system' };
  to: { id?: string; email?: string; name?: string }[];
  subject?: string;
  content: string;
  htmlContent?: string;
  attachments: { name: string; url: string; mimeType: string }[];
  status: 'draft' | 'sent' | 'delivered' | 'failed';
  relatedTo?: { type: string; id: string };
  sentAt?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  workspaceId: string;
  recipientId: string;
  type: 'info' | 'warning' | 'success' | 'error' | 'mention' | 'assignment' | 'deadline';
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export interface CommunicationModuleConfig {
  db: BusinessDatabase;
  bus: BusinessEventBus;
}

export class CommunicationModule {
  constructor(private config: CommunicationModuleConfig) {}

  // ─── NOTIFICATIONS ───

  notify(workspaceId: string, params: {
    recipientId: string; type: Notification['type']; title: string; body: string; link?: string;
  }): Notification {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    this.config.db.prepare(`
      INSERT INTO biz_events (id, workspace_id, type, source, data, timestamp)
      VALUES (?, ?, 'notification.created', 'communication', ?, ?)
    `).run(id, workspaceId, JSON.stringify({ ...params, read: false }), now);

    return { id, workspaceId, ...params, read: false, createdAt: now };
  }

  getNotifications(_workspaceId: string, _recipientId: string): Notification[] {
    // Retrieved from events
    return [];
  }

  markRead(_notificationId: string): void {}

  // ─── MESSAGING ───

  /**
   * Send a message through the appropriate channel.
   * Delegates to XR Plugin Platform for external channels.
   */
  async sendMessage(workspaceId: string, params: {
    channel: Message['channel']; from: Message['from']; to: Message['to'];
    subject?: string; content: string; htmlContent?: string;
    attachments?: Message['attachments']; relatedTo?: Message['relatedTo'];
  }): Promise<Message> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const message: Message = {
      id, workspaceId, ...params,
      attachments: params.attachments ?? [],
      status: 'sent', sentAt: now, createdAt: now,
    };

    // Emit event for plugins to handle actual sending
    await this.config.bus.emit('message.send', {
      workspaceId, source: 'communication',
      payload: { messageId: id, channel: params.channel, to: params.to, subject: params.subject, content: params.content },
    });

    return message;
  }

  /**
   * Send email template.
   */
  async sendEmail(workspaceId: string, params: {
    to: string; subject: string; content: string; htmlContent?: string;
    from?: string; relatedTo?: Message['relatedTo'];
  }): Promise<Message> {
    return this.sendMessage(workspaceId, {
      channel: 'email',
      from: { id: params.from ?? 'system', name: params.from ?? 'System', type: 'system' },
      to: [{ email: params.to }],
      subject: params.subject,
      content: params.content,
      htmlContent: params.htmlContent,
      relatedTo: params.relatedTo,
    });
  }

  // ─── TEMPLATES ───

  private templates = new Map<string, { subject: string; body: string; html?: string }>();

  registerTemplate(id: string, template: { subject: string; body: string; html?: string }): void {
    this.templates.set(id, template);
  }

  renderTemplate(templateId: string, variables: Record<string, string>): { subject: string; body: string; html?: string } | null {
    const template = this.templates.get(templateId);
    if (!template) return null;

    let subject = template.subject;
    let body = template.body;
    let html = template.html;

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      subject = subject.replace(new RegExp(placeholder, 'g'), value);
      body = body.replace(new RegExp(placeholder, 'g'), value);
      if (html) html = html.replace(new RegExp(placeholder, 'g'), value);
    }

    return { subject, body, html };
  }

  isHealthy(): boolean { return true; }
}
