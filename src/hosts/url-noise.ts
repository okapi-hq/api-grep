/**
 * URLs on an API's host that are no call by their path (`coverage.hosts`): a page a browser opens in an OAuth flow, an
 * OAuth scope, a documentation page, a value written for a person to fill in.
 */

/**
 * The authorization endpoint of an OAuth flow, which the user's browser opens: `/authorize` alone (Auth0), or after an
 * `oauth`, `oauth2`, `connect`, `auth` or `openidconnect` segment (`/oauth2/v2.0/authorize`, `/login/oauth/authorize`,
 * `/oauth/v2/authorize`), Google's `/o/oauth2/v2/auth`, Keycloak's `/protocol/openid-connect/auth`. The token, device
 * and introspection endpoints are server calls and stay, and so does a payment's `/orders/{id}/authorize`.
 */
const OAUTH_AUTHORIZE = /^(?:\/authorize|.*\/(?:oauth2?|connect|auth|openidconnect)(?:\/v[\d.]+)?\/(?:authorize|authenticate)|.*\/oauth2?(?:\/v[\d.]+)?\/auth|.*\/openid-connect\/auth)\/?$/i;

/** OAuth scopes, which are names written as URLs: Google's (`www.googleapis.com/auth/drive`), Microsoft Graph's (`/User.Read`, `/.default`). */
const GOOGLE_SCOPE = /^\/auth\/[a-z]/;
const GRAPH_SCOPE = /^\/(?:\.default|[A-Z][A-Za-z]*(?:\.[A-Z][A-Za-z]*)+)$/;

/** Path segments that read as a documentation page, not an endpoint (`api.slack.com/robots`, `/reference/...`). */
const DOC_SEGMENTS = new Set(["docs", "doc", "documentation", "reference", "references", "robots", "guide", "guides", "tutorial", "tutorials", "faq", "manual", "changelog", "help", "learn", "wiki", "blog", "pricing", "terms", "privacy", "legal"]);
/** Those that never begin an API's path; `help`, `learn`... may, but do not under a link (`{ name, url }`). */
const DOC_FIRST = new Set(["docs", "documentation", "reference", "references", "robots", "guides", "tutorials", "faq", "manual", "changelog"]);
/** A locale segment before a docs page (`/en/docs`, `/en-us/reference`). */
const LOCALE = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;

/**
 * On a generic cloud endpoint, whose host is a region or a service and whose account or project is in the path
 * (`sqs.us-east-1.amazonaws.com/<account>/<queue>`), a segment written for a person to replace (`your-account-id`,
 * `YOUR_PROJECT`, `{your_key}`, `XXX`, `changeme`) or a sample's (`example`, `my-queue`, `123456789012`): a default to
 * edit, not a URL the code calls as written. Elsewhere such a URL is often the one a call sends
 * (`fetch("https://hooks.slack.com/services/T000/B000/XXXX")`), so it counts.
 */
const PLACEHOLDER = /^(?:your[-_]?[a-z0-9].*|x{3,}|changeme|change[-_]me|replace[-_]?me|placeholder|\.\.\.|…|example|sample|dummy|my[-_]?[a-z]+|0{12}|1{12}|123456789012)$/i;
const GENERIC_CLOUD = /(?:^|\.)(?:amazonaws\.com(?:\.cn)?|googleapis\.com|windows\.net|azure\.com|digitaloceanspaces\.com|cloudflare\.com)$/;

const segmentsOf = (path: string): string[] =>
  path
    .replace(/[?#].*$/s, "")
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/^[{<[]+|[}>\]]+$/g, ""));

/** Whether a path reads as a documentation page: its first segment (after a locale), or with `anywhere` any segment. */
export function isDocsPath(path: string, anywhere = false): boolean {
  const segs = segmentsOf(path).map((s) => s.toLowerCase());
  if (anywhere) return segs.some((s) => DOC_SEGMENTS.has(s));
  const first = segs[0] !== undefined && LOCALE.test(segs[0]) && segs.length > 1 ? segs[1] : segs[0];
  return first !== undefined && DOC_FIRST.has(first);
}

/** Whether a generic cloud endpoint's path holds a segment written for a person to fill in. */
export function hasPlaceholderSegment(host: string, path: string): boolean {
  return GENERIC_CLOUD.test(host) && segmentsOf(path).some((s) => PLACEHOLDER.test(s));
}

/** A URL that is no call by its path: an OAuth authorization page or scope, a docs page, a cloud endpoint to fill in. */
export function isNoCallPath(host: string, path: string): boolean {
  const bare = path.replace(/[?#].*$/s, "");
  if (OAUTH_AUTHORIZE.test(bare) || /[?&]response_type=/i.test(path)) return true;
  if ((host.endsWith(".googleapis.com") && GOOGLE_SCOPE.test(bare)) || (host === "graph.microsoft.com" && GRAPH_SCOPE.test(bare))) return true;
  return isDocsPath(bare) || hasPlaceholderSegment(host, bare);
}
