/** A bundle, not the gaps between per-file fetches, owns download liveness.
 * Retain terminal evidence for pollers that did not have an SSE subscriber.
 *
 * B1/B15 — admission is synchronous and typed: a second start while a bundle
 * runs gets `{ started: false, reason: "busy" }` (the route answers 409) instead
 * of a thrown "download-busy" inside a fire-and-forget chain. `done` never
 * rejects: an unexpected fault becomes a terminal `error` progress record. */
import { VoiceDownloader, entryBytes, type DownloadProgress, type VoiceModelEntry } from "./models.ts";
import { describeThrown } from "../util/thrown.ts";
export type VoiceBundleProgress = DownloadProgress & { bundleReceived: number; bundleTotal: number };
export type VoiceDownloadStart =
  | { started: true; done: Promise<void> }
  | { started: false; reason: "busy"; current: VoiceBundleProgress | null };
export class VoiceDownloads {
  private running = false;
  private cancelled = false;
  private progress: VoiceBundleProgress | null = null;
  constructor(private emit: (p: VoiceBundleProgress) => void, private downloader: Pick<VoiceDownloader, "download" | "cancel"> = new VoiceDownloader()) {}
  busy(): boolean { return this.running; }
  current(): VoiceBundleProgress | null { return this.progress; }
  cancel(): void { this.cancelled = true; this.downloader.cancel(); }
  start(entries: VoiceModelEntry[]): VoiceDownloadStart {
    if (this.running) return { started: false, reason: "busy", current: this.progress };
    this.running = entries.length > 0;
    this.cancelled = false;
    this.progress = null;
    const done = this.run(entries)
      .catch((e) => this.terminalError(`Voice download failed: ${describeThrown(e)}`))
      .finally(() => { this.running = false; });
    return { started: true, done };
  }
  /** A subscriber fault is the subscriber's problem; it never fails or aborts the download. */
  private publishSafe(p: VoiceBundleProgress): void {
    this.progress = p;
    try { this.emit(p); } catch { /* the session audits faulty subscribers */ }
  }
  private terminalError(detail: string): void {
    const p = this.progress;
    this.publishSafe({ id: p?.id ?? "voice", component: p?.component ?? "runtime", received: p?.received ?? 0, total: p?.total ?? 0, percent: p?.percent ?? 0, bundleReceived: p?.bundleReceived ?? 0, bundleTotal: p?.bundleTotal ?? 0, status: "error", detail });
  }
  private async run(entries: VoiceModelEntry[]): Promise<void> {
    const bundleTotal = entries.reduce((n, e) => n + entryBytes(e), 0);
    let done = 0;
    const publish = (p: DownloadProgress) => {
      const status = p.status === "done" && done + p.received < bundleTotal ? "downloading" : p.status;
      this.publishSafe({ ...p, status, bundleReceived: done + p.received, bundleTotal });
    };
    for (const e of entries) {
      if (this.cancelled) { const p = this.current(); if (p) publish({ ...p, received: 0, status: "cancelled" }); break; }
      publish({ id: e.id, component: e.component, received: 0, total: entryBytes(e), percent: 0, status: "downloading" });
      const out = await this.downloader.download(e, publish);
      if (out.status !== "done") { publish(out); break; }
      done += entryBytes(e);
    }
  }
}
