/**
 * Phase 26 · WhatsApp — operation contract entries. Spread into the main
 * registry in contract.ts. Responses are the { ok, … } envelope or the status
 * view from whatsapp.routes.ts; credentials are never part of a response.
 */
import type { ApiOperationMeta } from "./contract.ts";
import {
  WhatsAppContactAddRequest,
  WhatsAppContactRemoveRequest,
  WhatsAppDisconnectRequest,
  WhatsAppLogsQuery,
  WhatsAppQrQuery,
  WhatsAppSettingsRequest,
  WhatsAppUnpairRequest,
} from "./schemas-whatsapp.ts";

const whatsapp = { tag: "whatsapp", stability: "experimental" as const };

export const WHATSAPP_CONTRACT: Record<string, ApiOperationMeta> = {
  "whatsapp.status": {
    ...whatsapp,
    summary:
      "WhatsApp link state: linked device, connection, QR window, allowed contacts, outbox, caps and per-chat settings. Never includes credentials.",
    template: "/api/whatsapp/status",
  },
  "whatsapp.connect": {
    ...whatsapp,
    summary: "Open the linked-device connection. With credentials on disk this resumes silently, with no QR.",
    template: "/api/whatsapp/connect",
  },
  "whatsapp.start": {
    ...whatsapp,
    summary: "Same as connect: start the linked device and mark the surface enabled.",
    template: "/api/whatsapp/start",
  },
  "whatsapp.stop": {
    ...whatsapp,
    summary: "Close the socket but keep the link, so a later start resumes without a QR.",
    template: "/api/whatsapp/stop",
  },
  "whatsapp.disconnect": {
    ...whatsapp,
    summary: "Unlink the device: ask WhatsApp to log out, wipe the sealed credentials and stop. Requires confirm: true.",
    template: "/api/whatsapp/disconnect",
    request: WhatsAppDisconnectRequest,
  },
  "whatsapp.unpair": {
    ...whatsapp,
    summary: "The same unlink action, named the way the dialog's button reads. Requires confirm: true.",
    template: "/api/whatsapp/unpair",
    request: WhatsAppUnpairRequest,
  },
  "whatsapp.pair": {
    ...whatsapp,
    summary: "Open the QR pairing window (three minutes). Refused while a device is already linked.",
    template: "/api/whatsapp/pair",
  },
  "whatsapp.pair.close": {
    ...whatsapp,
    summary: "Close the QR window early and stop offering frames.",
    template: "/api/whatsapp/pair/close",
  },
  "whatsapp.contacts.add": {
    ...whatsapp,
    summary: "Allow one contact number to talk to XR. Anything not on this list is ignored in silence.",
    template: "/api/whatsapp/contacts/add",
    request: WhatsAppContactAddRequest,
  },
  "whatsapp.contacts.remove": {
    ...whatsapp,
    summary: "Revoke one contact number. Their chat stops being answered immediately.",
    template: "/api/whatsapp/contacts/remove",
    request: WhatsAppContactRemoveRequest,
  },
  "whatsapp.settings": {
    ...whatsapp,
    summary: "Update the message rate, attachment cap, outbox switch and auto-start. Only sent fields change.",
    template: "/api/whatsapp/settings",
    request: WhatsAppSettingsRequest,
  },
  "whatsapp.logs": {
    ...whatsapp,
    summary: "Redacted tail of the WhatsApp log. Phone numbers appear as last four digits only.",
    template: "/api/whatsapp/logs",
    request: WhatsAppLogsQuery,
  },
  "whatsapp.qr": {
    ...whatsapp,
    summary:
      "Server-sent events: QR frames as PNG data URLs while pairing, then a terminal state (open, timeout, closed or error).",
    template: "/api/whatsapp/qr",
    request: WhatsAppQrQuery,
  },
};
