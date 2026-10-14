# Business email — compliance requirements

> Phase 31 · Bucket B · B9. This document is the specification the Phase 30
> transactional/marketing email implementation must satisfy. It is a doc now;
> the sending code lands with Phase 30's email work. Nothing here authorises
> sending anything before that implementation exists.

## Every email, transactional or marketing

- Sender identification: mail is sent from an XR domain (`xr.rrrtx.ai`) with a
  named, monitored mailbox (`billing@`, `security@`, `support@`) — never a
  no-reply address you cannot answer.
- Physical postal address in the footer: [TO FILL: registered office address].
  A footer without a real address fails this spec and must not ship.
- Non-deceptive subject lines: the subject describes the email's actual
  content. No fake "Re:", no fake invoice numbers, no urgency the email
  itself does not justify.
- Authentication: SPF, DKIM and DMARC aligned for the sending domain before
  the first send. (Phase 30 launch checklist.)

## Marketing email

- One-click unsubscribe link in every message, honoured within 10 business
  days — in practice immediately, because the suppression list is checked at
  send time.
- No purchased lists. No scraped addresses. No "partner" lists. An address is
  marketable only if the person gave it to us and opted in (the privacy
  policy promises opt-in; the first newsletter does not exist in v1).
- Unsubscribing from marketing never unsubscribes anyone from transactional
  mail about their own account.
- List-Unsubscribe header (RFC 8058) set, so mail clients can offer their
  native unsubscribe button.

## Transactional email

Receipts, password resets, security alerts, trial-ending notices and
similar account mail:

- Do not need an unsubscribe link (there is nothing to unsubscribe from — the
  account relationship is the basis), but **must** carry the postal address
  footer and a line explaining why the recipient received the mail and how to
  manage the account it belongs to.
- Security alerts (new sign-in, password change, session revoked) are never
  suppressed by marketing preferences, frequency caps or quiet hours.
- Every transactional template links to the account or console page where the
  user can change the underlying setting; an email that announces something
  the user cannot act on is a bug.

## Data handling

- Email addresses are account data under `docs/business/` retention rules:
  deleted with the account, purged on the privacy policy's schedule.
- Email content is never used for advertising profiles, and delivery/open
  metrics are kept only in aggregate for deliverability debugging — no
  per-user open tracking pixels in transactional mail.
