#!/usr/bin/env bun
/**
 * Internal link crawler (Phase 31 · Bucket C · C2).
 *
 *   bun run build && bun run start &   # or any running instance
 *   bun run crawl:links [baseUrl]
 *
 * Starts at `/`, extracts same-site hrefs from every HTML page it can
 * reach, fetches each one, and reports any that answer 4xx/5xx. External
 * URLs are never fetched (no network noise, no flaky CI); asset files
 * (/_next chunks, images, the manifest) are fetched once as-is because a
 * missing icon is a broken link too. Exits 1 when anything is broken.
 */
const base = (process.argv[2] ?? process.env.CRAWL_BASE ?? "http://127.0.0.1:3000").replace(/\/$/, "");

const seen = new Map<string, number>(); // path -> status
const queue: string[] = ["/"];
const referrers = new Map<string, string>();

const isPage = (path: string) =>
  !path.startsWith("/_next/") && !/\.(png|jpg|jpeg|gif|webp|svg|ico|webmanifest|woff2?|css|js|map)$/.test(path);

async function fetchStatus(url: string): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    return { status: res.status, body: res.status === 200 ? await res.text() : "" };
  } catch {
    return { status: 0, body: "" };
  }
}

console.log(`crawling ${base} …`);
while (queue.length > 0) {
  const path = queue.shift()!;
  if (seen.has(path)) continue;
  const { status, body } = await fetchStatus(base + path);
  seen.set(path, status);
  if (status !== 200 || !isPage(path)) continue;
  for (const m of body.matchAll(/href="([^"#]+)"/g)) {
    const href = m[1]!;
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const clean = href.split("#")[0]!.split("?")[0] || "/";
    if (!seen.has(clean) && !queue.includes(clean)) {
      queue.push(clean);
      if (!referrers.has(clean)) referrers.set(clean, path);
    }
  }
}

const broken = [...seen.entries()].filter(([, s]) => s !== 200);
for (const [path, status] of [...seen.entries()].sort()) {
  if (status !== 200) {
    console.log(`  ✗ ${status} ${path}  (linked from ${referrers.get(path) ?? "?"})`);
  }
}
console.log(`crawled ${seen.size} internal URLs · ${broken.length} broken`);
if (broken.length > 0) process.exit(1);
console.log("✓ zero internal 404/500s");

export {};
