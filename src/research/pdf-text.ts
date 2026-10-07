/**
 * XR Phase 18 — PDF → text for research documents.
 *
 * Runs in the engine process with `unpdf` (pdf.js, serverless build, no
 * workers, no DOM). The bytes stay in memory: nothing is written to disk and
 * nothing leaves the machine. Caps keep a hostile file from pinning the
 * daemon: 20 MB in, 400 pages, 600k characters out.
 */

export const PDF_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_PAGES = 400;
export const PDF_MAX_CHARS = 600_000;

export interface PdfTextResult {
  pages: number;
  /** Pages actually read (≤ PDF_MAX_PAGES). */
  pagesRead: number;
  chars: number;
  text: string;
  truncated: boolean;
}

export class PdfTextError extends Error {
  readonly code: "too_large" | "not_pdf" | "encrypted" | "unreadable" | "empty";
  constructor(code: PdfTextError["code"], message: string) {
    super(message);
    this.name = "PdfTextError";
    this.code = code;
  }
}

function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" within the first 1 KiB (some writers prepend junk/BOM).
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  if (bytes.byteLength === 0) throw new PdfTextError("empty", "The file is empty.");
  if (bytes.byteLength > PDF_MAX_BYTES) throw new PdfTextError("too_large", "PDF too large (max 20MB)");
  if (!looksLikePdf(bytes)) throw new PdfTextError("not_pdf", "That file is not a PDF.");

  const { getDocumentProxy, extractText } = await import("unpdf");
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password|encrypt/i.test(msg)) throw new PdfTextError("encrypted", "The PDF is password-protected.");
    throw new PdfTextError("unreadable", "The PDF could not be parsed.");
  }
  const pages = pdf.numPages;
  const pagesRead = Math.min(pages, PDF_MAX_PAGES);
  let text = "";
  try {
    const { text: perPage } = await extractText(pdf, { mergePages: false });
    const parts: string[] = [];
    for (let i = 0; i < pagesRead; i++) parts.push((perPage[i] ?? "").replace(/[ \t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
    text = parts.filter(Boolean).join("\n\n");
  } catch {
    throw new PdfTextError("unreadable", "The PDF's text layer could not be read.");
  } finally {
    try {
      await pdf.loadingTask.destroy();
    } catch {
      /* already released */
    }
  }
  const truncated = text.length > PDF_MAX_CHARS || pages > pagesRead;
  if (text.length > PDF_MAX_CHARS) text = text.slice(0, PDF_MAX_CHARS);
  if (!text.trim()) throw new PdfTextError("empty", "No extractable text (scanned PDF without a text layer).");
  return { pages, pagesRead, chars: text.length, text, truncated };
}
