/**
 * XR Cloud — S3-compatible blob store for audit exports.
 *
 * Only one thing is ever written here: a signed export of an organization's own
 * audit log, at that organization's request. No user content, no prompts, no
 * memory bodies. If that ever stops being true, this file is where a reviewer
 * will see it.
 *
 * Two implementations, same honesty rule as the Stripe gateway:
 *
 *   - `S3BlobStore` — real `@aws-sdk/client-s3` against any S3-compatible
 *     endpoint (AWS, Cloudflare R2, MinIO, Backblaze B2). Path-style addressing
 *     is a flag, because R2 and MinIO both need it.
 *   - `LocalBlobStore` — writes export files to a directory and returns a
 *     `file://` reference, which the export job then serves through an
 *     authenticated download route. This is what lets the export feature be
 *     tested end-to-end without cloud credentials, and what a single-box
 *     Enterprise install would actually use.
 *
 * Either way the object is **never** exposed as a public URL. A download always
 * goes through a short-lived signed URL (`S3`) or an authenticated route
 * (`local`), so an audit export cannot be leaked by guessing a path.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { CloudEnv } from "../env.ts";
import { internal } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";

export interface PutResult {
  /** `s3://bucket/key` or `file:///abs/path`. Opaque to callers. */
  readonly ref: string;
  /** SHA-256 of the stored bytes, so a download can be verified independently. */
  readonly digest: string;
  readonly bytes: number;
}

export interface BlobStore {
  readonly kind: "s3" | "local";
  put(key: string, body: string, contentType: string): Promise<PutResult>;
  /** Short-lived URL. `null` means "serve it yourself through an authed route". */
  signedUrl(key: string, expiresInSeconds: number): Promise<string | null>;
  /** Used by the authenticated local-download path. */
  readLocal(key: string): Promise<string | null>;
  delete(key: string): Promise<void>;
}

function safeKey(key: string): string {
  // Defence in depth: a key is built from ids, but a traversal sequence in a key
  // would be catastrophic for the local store, so it is refused here.
  if (key.includes("..") || key.startsWith("/") || key.includes("\0")) {
    throw internal();
  }
  return key;
}

class LocalBlobStore implements BlobStore {
  readonly kind = "local" as const;
  constructor(
    private readonly root: string,
    private readonly log: Logger,
  ) {}

  private path(key: string): string {
    return join(this.root, safeKey(key));
  }

  async put(key: string, body: string, _contentType: string): Promise<PutResult> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(key);
    await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
    const digest = createHash("sha256").update(body).digest("hex");
    this.log.info({ key, bytes: Buffer.byteLength(body) }, "export stored locally");
    return { ref: `file://${path}`, digest, bytes: Buffer.byteLength(body) };
  }

  async signedUrl(): Promise<string | null> {
    // Honest answer: there is no pre-signed capability on a local filesystem.
    // The caller falls back to the authenticated download route.
    return null;
  }

  async readLocal(key: string): Promise<string | null> {
    try {
      await stat(this.path(key));
      return await readFile(this.path(key), "utf8");
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    await unlink(this.path(key)).catch(() => undefined);
  }
}

class S3BlobStore implements BlobStore {
  readonly kind = "s3" as const;
  private readonly client: S3Client;
  constructor(
    env: CloudEnv,
    private readonly bucket: string,
    private readonly log: Logger,
  ) {
    this.client = new S3Client({
      region: env.S3_REGION ?? "auto",
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }

  async put(key: string, body: string, contentType: string): Promise<PutResult> {
    const bytes = Buffer.byteLength(body);
    const digest = createHash("sha256").update(body).digest("hex");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        Body: body,
        ContentType: contentType,
        // Server-side encryption at rest, independent of the application-level
        // encryption this service already applies.
        ServerSideEncryption: "AES256",
        Metadata: { "xr-sha256": digest },
      }),
    );
    this.log.info({ bucket: this.bucket, key, bytes }, "export stored in object storage");
    return { ref: `s3://${this.bucket}/${key}`, digest, bytes };
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string | null> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
        { expiresIn: Math.max(60, Math.min(expiresInSeconds, 86_400)) },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.log.error({ detail }, "could not sign export URL");
      return null;
    }
  }

  async readLocal(): Promise<string | null> {
    return null;
  }

  async delete(key: string): Promise<void> {
    await this.client
      .send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }))
      .catch(() => undefined);
  }
}

export function createBlobStore(env: CloudEnv, log: Logger): BlobStore {
  const ready =
    env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.capabilities.blobStorage.state === "ready";
  if (ready && env.S3_BUCKET) return new S3BlobStore(env, env.S3_BUCKET, log);
  return new LocalBlobStore(join(env.PGLITE_DIR, "..", ".xr-cloud-exports"), log);
}
