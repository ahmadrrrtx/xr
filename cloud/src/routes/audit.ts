/**
 * XR Cloud — audit routes.
 *
 * ## The export is a job, not a request
 *
 * The brief describes `POST /teams/:id/audit/export` as returning "a signed URL
 * after processing". Implemented literally, that is a request that blocks until an
 * arbitrarily large export finishes — which is a timeout waiting to happen, and a
 * timeout that fires *after* the S3 object exists but *before* the client learns
 * its key. So:
 *
 *   POST   → 202 { jobId }        (queued)
 *   GET    → { status: ready, downloadUrl } once the object is written
 *
 * The download URL is short-lived (15 minutes) and, on a local blob store where
 * pre-signing does not exist, is `null` with the job id used against the
 * authenticated download route instead. Both paths are stated in the response
 * rather than one being quietly absent.
 *
 * ## Chain verification is available to the customer
 *
 * `GET /teams/:id/audit/verify` replays the org's hash chain and reports the first
 * broken link, if any. An audit log a customer cannot verify is a log they have
 * to take on faith, and this project's entire position is that claims carry
 * evidence (Constitution Art. IX.4).
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { auditLogs, exportJobs } from "../db/schema.ts";
import { badRequest, conflict, notFound, validationFailed } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { requireOrgMember, requireRole, requireUser } from "../middleware/auth.ts";
import { parseBody, parseQuery } from "../middleware/validate.ts";
import { auditExportSchema, auditQuerySchema } from "../schemas.ts";

const EXPORT_URL_TTL_SECONDS = 900;

export function auditRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.get("/teams/:id/audit", requireUser(deps), requireOrgMember(deps, "id"), requireRole(["owner", "admin"]), async (c) => {
    const member = c.get("currentMember");
    const query = parseQuery(c, auditQuerySchema);

    const from = parseDate(query.from);
    const to = parseDate(query.to);
    if (query.from && !from) throw validationFailed({ from: "Use an ISO-8601 timestamp." });
    if (query.to && !to) throw validationFailed({ to: "Use an ISO-8601 timestamp." });

    const { rows, nextCursor } = await deps.audit.list(member.orgId, {
      limit: query.limit,
      ...(query.actor ? { actorEmail: query.actor.toLowerCase() } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.target ? { targetId: query.target } : {}),
      ...(query.workspace ? { workspaceId: query.workspace } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });

    auditDetachedReads(deps, member.orgId, c.get("auth").userId, c.get("currentUser").email, c.get("meta").ip, query);

    return c.json({
      entries: rows.map((row) => ({
        id: row.id,
        seq: row.seq,
        at: row.createdAt.toISOString(),
        actorKind: row.actorKind,
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        workspaceId: row.workspaceId,
        ip: row.ip,
        detail: row.detail,
        entryHash: row.entryHash,
        prevHash: row.prevHash,
      })),
      nextCursor,
      // Retention is reported on every read so an admin exporting "everything"
      // knows whether the window they asked for is the window that exists.
      retentionDays: await retentionDays(deps, member.orgId),
    });
  });

  app.get(
    "/teams/:id/audit/verify",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const head = await deps.audit.head(member.orgId);
      const verification = await deps.audit.verifyChain(member.orgId);
      return c.json({
        ok: verification.ok,
        entriesChecked: verification.checked,
        chainHead: { seq: head.seq, hash: head.hash },
        brokenAt: verification.brokenAt ?? null,
        reason: verification.reason ?? null,
        // The honest boundary of what this proves, on the wire, so no client has
        // to guess and no sales page can overstate it.
        scope:
          "Hash-chain verification detects edits, reordering and deletion within this log. It does not prove the log was not rebuilt wholesale by an actor who could also write the database — that requires the asymmetric anchor, which is a post-v1 item.",
      });
    },
  );

  app.post(
    "/teams/:id/audit/export",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const meta = c.get("meta");

      const limited = await deps.limiter.consume("export", `org:${member.orgId}`);
      if (!limited.allowed) {
        throw conflict(
          `Exports are limited to 5 per hour per team. Try again in ${limited.retryAfterSeconds ?? 60} seconds.`,
          "If you need continuous export, use the API with an `audit:read` scoped key and page through `GET /teams/:id/audit` instead.",
        );
      }

      const body = await parseBody(c, auditExportSchema);
      const from = parseDate(body.from);
      const to = parseDate(body.to);

      const jobId = newId("exportJob");
      await deps.db.insert(exportJobs).values({
        id: jobId,
        orgId: member.orgId,
        kind: "audit",
        format: body.format,
        status: "queued",
        filters: {
          ...(body.actor ? { actor: body.actor } : {}),
          ...(body.action ? { action: body.action } : {}),
          ...(from ? { from: from.toISOString() } : {}),
          ...(to ? { to: to.toISOString() } : {}),
        },
        requestedBy: c.get("auth").userId,
      });

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "audit.export_requested",
        targetType: "export_job",
        targetId: jobId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { format: body.format, filtersPresent: Object.keys(body).length > 1 },
      });

      // Run it now, inline, but report through the job so the client contract is
      // the same whether the work took 5ms or (on a real deployment, with a
      // queue) five minutes.
      void runExport(deps, jobId, member.orgId, body.format, c.get("auth").userId).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        deps.log.error({ jobId, detail }, "audit export failed");
      });

      return c.json({ jobId, status: "queued", checkAt: `/teams/${member.orgId}/audit/export/${jobId}` }, 202);
    },
  );

  app.get(
    "/teams/:id/audit/export/:jobId",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const jobId = c.req.param("jobId");
      if (!jobId) throw badRequest("Missing export job id.");

      const rows = await deps.db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, jobId), eq(exportJobs.orgId, member.orgId)))
        .limit(1);
      const job = rows[0];
      if (!job) throw notFound("Export job");

      if (job.status !== "ready" || !job.objectKey) {
        return c.json(
          {
            jobId: job.id,
            status: job.status,
            rowCount: job.rowCount,
            error: job.error,
            ...(job.status === "failed"
              ? {
                  repair:
                    "The export could not be written. Check GET /readyz → checks.blobStorage if the deployment uses S3, then request a new export.",
                }
              : {}),
          },
          200,
        );
      }

      const signed = await deps.blob.signedUrl(job.objectKey, EXPORT_URL_TTL_SECONDS);
      return c.json({
        jobId: job.id,
        status: job.status,
        rowCount: job.rowCount,
        format: job.format,
        digest: job.objectDigest,
        // Exact bytes downloaded will hash to `digest`. Stated so a compliance
        // officer can prove the file they filed is the file XR produced.
        digestAlgorithm: "sha256",
        downloadUrl: signed,
        downloadUrlExpiresInSeconds: signed ? EXPORT_URL_TTL_SECONDS : null,
        // Local blob stores cannot pre-sign, so the authenticated route is the
        // path — and it is named rather than left for the client to discover.
        fallback: signed ? null : `/teams/${member.orgId}/audit/export/${job.id}/download`,
      });
    },
  );

  app.get(
    "/teams/:id/audit/export/:jobId/download",
    requireUser(deps),
    requireOrgMember(deps, "id"),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const jobId = c.req.param("jobId");
      if (!jobId) throw badRequest("Missing export job id.");
      const rows = await deps.db
        .select()
        .from(exportJobs)
        .where(and(eq(exportJobs.id, jobId), eq(exportJobs.orgId, member.orgId)))
        .limit(1);
      const job = rows[0];
      if (!job?.objectKey) throw notFound("Export");

      const body = await deps.blob.readLocal(job.objectKey);
      if (body === null) {
        // Either the deployment is S3-backed, or the file aged out. Both are
        // actionable, so the message says which.
        throw conflict(
          "That export is not available on this server.",
          "If this deployment uses object storage, use the signed URL from the job status. Otherwise the file may have been cleaned up — request a new export.",
        );
      }

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "audit.export_downloaded",
        targetType: "export_job",
        targetId: jobId,
        ip: c.get("meta").ip,
      });

      const contentType = job.format === "csv" ? "text/csv" : "application/json";
      return c.body(body, 200, {
        "content-type": `${contentType}; charset=utf-8`,
        "content-disposition": `attachment; filename="xr-audit-${member.orgId}-${jobId}.${job.format}"`,
        "x-xr-digest-sha256": job.objectDigest ?? "",
      });
    },
  );

  return app;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reading the audit log is itself an auditable act (brief §J). Written detached
 * so a page load does not wait on a chain append.
 */
function auditDetachedReads(
  deps: AppDeps,
  orgId: string,
  userId: string,
  email: string,
  ip: string,
  query: Record<string, unknown>,
): void {
  const filters = Object.keys(query).filter((k) => k !== "limit" && k !== "cursor");
  void deps.audit
    .append({
      orgId,
      actorKind: "user",
      actorId: userId,
      actorEmail: email,
      action: "audit.read",
      targetType: "org",
      targetId: orgId,
      ip,
      detail: { filtersUsed: filters, hasCursor: Boolean(query.cursor) },
    })
    .catch(() => undefined);
}

async function retentionDays(deps: AppDeps, orgId: string): Promise<number> {
  const { policies } = await import("../db/schema.ts");
  const rows = await deps.db
    .select({ days: policies.auditRetentionDays })
    .from(policies)
    .where(eq(policies.orgId, orgId))
    .limit(1);
  return rows[0]?.days ?? 365;
}

/**
 * Build and store an export.
 *
 * CSV is RFC 4180-quoted with a UTF-8 BOM so Excel opens it correctly — a
 * compliance export that a spreadsheet mangles is a compliance export that gets
 * re-done. The `detail` column is JSON-encoded rather than flattened, because
 * flattening loses the structure an investigator is looking for.
 */
async function runExport(
  deps: AppDeps,
  jobId: string,
  orgId: string,
  format: "csv" | "json",
  requestedBy: string,
): Promise<void> {
  await deps.db.update(exportJobs).set({ status: "running", startedAt: deps.clock() }).where(eq(exportJobs.id, jobId));

  const rows = await deps.db.select().from(auditLogs).where(eq(auditLogs.orgId, orgId)).orderBy(auditLogs.seq);

  const payload =
    format === "json"
      ? JSON.stringify(
          {
            generatedAt: deps.clock().toISOString(),
            orgId,
            requestedBy,
            rowCount: rows.length,
            note: "Detail values are structured. Memory bodies, prompts, secrets and tokens are never recorded in this log.",
            entries: rows.map((r) => ({
              seq: r.seq,
              at: r.createdAt.toISOString(),
              actorKind: r.actorKind,
              actorId: r.actorId,
              actorEmail: r.actorEmail,
              action: r.action,
              targetType: r.targetType,
              targetId: r.targetId,
              workspaceId: r.workspaceId,
              ip: r.ip,
              detail: r.detail,
              entryHash: r.entryHash,
              prevHash: r.prevHash,
            })),
          },
          null,
          2,
        )
      : toCsv(rows);

  const key = `audit/${orgId}/${jobId}.${format}`;
  const stored = await deps.blob.put(
    key,
    payload,
    format === "csv" ? "text/csv; charset=utf-8" : "application/json",
  );

  await deps.db
    .update(exportJobs)
    .set({
      status: "ready",
      objectKey: key,
      objectDigest: stored.digest,
      rowCount: rows.length,
      completedAt: deps.clock(),
    })
    .where(eq(exportJobs.id, jobId));
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Array<typeof auditLogs.$inferSelect>): string {
  const header = [
    "seq",
    "timestamp",
    "actor_kind",
    "actor_id",
    "actor_email",
    "action",
    "target_type",
    "target_id",
    "workspace_id",
    "ip",
    "detail",
    "entry_hash",
    "prev_hash",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.seq,
        r.createdAt.toISOString(),
        r.actorKind,
        csvCell(r.actorId),
        csvCell(r.actorEmail),
        r.action,
        csvCell(r.targetType),
        csvCell(r.targetId),
        csvCell(r.workspaceId),
        csvCell(r.ip),
        csvCell(r.detail),
        r.entryHash,
        r.prevHash,
      ].join(","),
    );
  }
  // BOM for Excel; CRLF per RFC 4180.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
