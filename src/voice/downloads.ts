/** A bundle, not the gaps between per-file fetches, owns download liveness.
 * Retain terminal evidence for pollers that did not have an SSE subscriber. */
import { VoiceDownloader, entryBytes, type DownloadProgress, type VoiceModelEntry } from "./models.ts";
export type VoiceBundleProgress = DownloadProgress & { bundleReceived: number; bundleTotal: number };
export class VoiceDownloads {
  private running = false;
  private cancelled = false;
  private progress: VoiceBundleProgress | null = null;
  constructor(private emit: (p: VoiceBundleProgress) => void, private downloader: Pick<VoiceDownloader, "download" | "cancel"> = new VoiceDownloader()) {}
  busy(): boolean { return this.running; }
  current(): VoiceBundleProgress | null { return this.progress; }
  cancel(): void { this.cancelled = true; this.downloader.cancel(); }
  async start(entries: VoiceModelEntry[]): Promise<void> {
    if (this.running) throw new Error("download-busy");
    this.running = entries.length > 0;
    this.cancelled = false;
    this.progress = null;
    const bundleTotal = entries.reduce((n, e) => n + entryBytes(e), 0);
    let done = 0;
    const publish = (p: DownloadProgress) => {
      const status = p.status === "done" && done + p.received < bundleTotal ? "downloading" : p.status;
      this.progress = { ...p, status, bundleReceived: done + p.received, bundleTotal };
      this.emit(this.progress);
    };
    try {
      for (const e of entries) {
        if (this.cancelled) { const p = this.current(); if (p) publish({ ...p, received: 0, status: "cancelled" }); break; }
        publish({ id: e.id, component: e.component, received: 0, total: entryBytes(e), percent: 0, status: "downloading" });
        const out = await this.downloader.download(e, publish);
        if (out.status !== "done") { publish(out); break; }
        done += entryBytes(e);
      }
    } catch {
      const p = this.current();
      if (p) { this.progress = { ...p, status: "error", detail: "Voice download failed" }; this.emit(this.progress); }
    } finally { this.running = false; }
  }
}
