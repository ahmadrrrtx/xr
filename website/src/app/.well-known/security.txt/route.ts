import { site } from "@/lib/site";

/**
 * `/.well-known/security.txt` (RFC 9116).
 *
 * Served from the site root rather than only from the API, because a researcher
 * who finds a problem in the marketing site or the dashboard should not have to
 * guess that there is a separate host with a different copy. The API serves an
 * identical document so either entry point works.
 *
 * `Expires` is required by the RFC and is deliberately close enough that the file
 * cannot be forgotten for years — a stale security.txt is worse than none, because
 * it points people at an address nobody reads any more.
 */
export const dynamic = "force-static";

const EXPIRES = "2027-10-14T00:00:00.000Z";

export function GET() {
  const body = [
    "Contact: mailto:security@xr.rrrtx.ai",
    "Contact: https://github.com/ahmadrrrtx/xr/security/advisories/new",
    `Expires: ${EXPIRES}`,
    "Preferred-Languages: en",
    `Canonical: ${site.url}/.well-known/security.txt`,
    `Policy: ${site.url}/security`,
    "# We acknowledge reports within two business days and tell you what we concluded,",
    "# including when the conclusion is that we disagree.",
    "# There is no bug bounty in v1.0.0. Credit in the release notes is offered and is not a payment.",
    "# Good-faith security research against your own account is authorised. Do not test against",
    "# other people's organizations, and do not run denial-of-service tests against shared infrastructure.",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
