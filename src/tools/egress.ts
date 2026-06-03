/**
 * XR — egress gate for network tools.
 * A URL may only be fetched if its host is on the allow-list. This is the
 * deterministic exfiltration killer that backs every network tool.
 */
export function hostAllowed(url: string, allowlist: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowlist.some(
    (d) => host === d.toLowerCase() || host.endsWith("." + d.toLowerCase()),
  );
}

/** Strip HTML to readable text (cheap, dependency-free). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
