import { isLocalhost, isProviderHost, providerForHost } from "../normalize/provider.js";

/**
 * Which hosts written in the code look like an API's (`coverage.hosts`). Noise is worse than a miss here: a link to the
 * docs counted as "named, not explained" would read as a call api-grep missed. The rules, in order: a well-formed
 * public host; not a placeholder, documentation, package registry, schema or asset host; then a known provider host,
 * an `api` label, an LLM gateway or an API-like path (a bare domain, `github.com`, needs the path).
 */

/** Top-level domains of names that never leave a private network, and reserved ones (RFC 2606, 6761). */
const INTERNAL_TLDS = new Set(["local", "localhost", "internal", "lan", "home", "corp", "intranet", "localdomain", "test", "example", "invalid", "svc", "cluster", "docker", "private", "arpa"]);

/** Domains (and their subdomains) that serve documentation, packages, schemas, media or social pages, never an API call. */
const NOISE_DOMAINS = [
  "example.com", "example.org", "example.net", "w3.org", "schema.org", "json-schema.org", "xmlns.com", "purl.org", "ogp.me",
  "shields.io", "badgen.net", "wikipedia.org", "wikimedia.org", "npmjs.com", "npmjs.org", "yarnpkg.com", "pypi.org", "pythonhosted.org",
  "python.org", "crates.io", "docs.rs", "pkg.go.dev", "golang.org", "go.dev", "packagist.org", "mvnrepository.com", "maven.org",
  "apache.org", "github.io", "githubusercontent.com", "readthedocs.io", "readthedocs.org", "gitbook.io", "notion.site", "medium.com",
  "dev.to", "stackoverflow.com", "stackexchange.com", "youtube.com", "youtu.be", "twitter.com", "x.com", "linkedin.com", "facebook.com",
  "instagram.com", "tiktok.com", "t.me", "telegram.me", "discord.gg", "reddit.com", "creativecommons.org", "opensource.org", "gnu.org",
  "mozilla.org", "ietf.org", "rfc-editor.org", "iana.org", "gravatar.com", "googleusercontent.com", "gstatic.com", "fonts.googleapis.com",
  "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com", "esm.sh", "deno.land", "skypack.dev", "unsplash.com", "placehold.co",
  "placeholder.com", "via.placeholder.com", "picsum.photos", "apple.com", "play.google.com", "microsoft.com", "swagger.io", "openapis.org",
];

/** Words of a first label that name documentation or a site page, alone or hyphenated (`docs`, `api-docs`, `status-page`). */
const DOC_WORDS = new Set(["docs", "doc", "documentation", "developer", "developers", "help", "support", "blog", "status", "community", "forum", "forums", "learn", "wiki", "guide", "guides"]);

/** First labels of dashboards and static content (`console.acme.com`, `cdn.acme.net`). */
const NOISE_LABELS = new Set([
  "img", "images", "image", "static", "assets", "fonts", "media", "cdn", "avatars", "badge", "badges", "gist", "console", "dashboard",
  "portal", "platform", "studio", "aistudio", "marketplace", "store", "shop", "news", "careers", "jobs",
]);

/** Code hosts: only their API and OAuth paths are calls, the rest are links to repositories. */
const CODE_HOSTS = new Set(["github.com", "gitlab.com", "bitbucket.org", "huggingface.co", "codeberg.org"]);
const CODE_HOST_API = /^\/(?:api|login\/oauth|oauth)(?:[/?#]|$)/;

/** LLM gateways and inference hosts with no provider entry and no `api` label. */
const GATEWAYS = [".cognitiveservices.azure.com", ".services.ai.azure.com", ".inference.ai.azure.com", ".endpoints.huggingface.cloud", ".modal.run", ".helicone.ai", "gateway.ai.cloudflare.com", ".portkey.ai"];

/** A versioned segment (`/v1/`, `/v2beta/`, `/v1.1`), `/api`, `/graphql`, `/rest/` or a bot token path (`/bot{token}/`). */
const API_PATH = /\/(?:(?:v\d+(?:\.\d+)?(?:alpha|beta)?\d*|api|graphql|rest)(?=[/?#.]|$)|bot(?:\{|\$\{|%s|\d+:|$))/i;

/** A page, an image, a script, a stylesheet, a font or an archive. */
const ASSET_PATH = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|mjs|map|woff2?|ttf|eot|html?|md|pdf|zip|t?gz|whl|mp[34]|wav|txt)$/i;

/** Placeholder names (`your-domain.com`, `api.yourservice.io`, `sample.org`). */
const PLACEHOLDER_LABEL = /^(?:your|example|sample|placeholder|dummy|fake|foo|bar|baz|xxx)/;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})$/;

/** `co.uk`, `com.br`: two-label public suffixes, so `api.acme.co.uk` is a subdomain of `acme.co.uk`. */
const TWO_LEVEL_SUFFIX = /\.(?:co|com|org|net|gov|ac|edu|ne|or)\.[a-z]{2}$/;

/** A public DNS name: lower case, two labels or more, an alphabetic top-level domain, no IP address. */
export function isPublicHostName(host: string): boolean {
  const labels = host.split(".");
  if (labels.length < 2 || host.length > 253 || !labels.every((l) => LABEL.test(l))) return false;
  const tld = labels[labels.length - 1]!;
  return TLD.test(tld) && !INTERNAL_TLDS.has(tld) && !isLocalhost(host);
}

/** `acme.com` for `api.acme.com`, `acme.co.uk` for `api.acme.co.uk`. */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  return labels.slice(TWO_LEVEL_SUFFIX.test(host) ? -3 : -2).join(".");
}

const isGateway = (host: string): boolean => GATEWAYS.some((g) => (g.startsWith(".") ? host.endsWith(g) : host === g));

const under = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

function isNoise(host: string): boolean {
  if (host.split(".").some((l) => PLACEHOLDER_LABEL.test(l))) return true;
  if (NOISE_DOMAINS.some((d) => under(host, d))) return true;
  const first = host.split(".")[0]!;
  return NOISE_LABELS.has(first) || first.split("-").some((w) => DOC_WORDS.has(w));
}

/** First label `api`, `api-*` or `*-api` (`api.openai.com`, `api-inference.huggingface.co`, `chat-api.acme.io`). */
export function hasApiLabel(host: string): boolean {
  const first = host.split(".")[0]!;
  return first === "api" || first.startsWith("api-") || first.endsWith("-api");
}

/**
 * Whether a host written in the code, with the path written after it, looks like an API's. `host` is lower case,
 * without port or user info; `path` starts with `/` or is empty.
 */
export function isApiHost(host: string, path: string): boolean {
  if (!isPublicHostName(host) || ASSET_PATH.test(path.replace(/[?#].*$/s, ""))) return false;
  const exact = isProviderHost(host);
  if (!exact && isNoise(host)) return false;
  const domain = registrableDomain(host);
  const bare = host === domain || host === `www.${domain}`;
  if (CODE_HOSTS.has(domain) && bare) return CODE_HOST_API.test(path);
  if (API_PATH.test(path)) return true;
  if (bare && !hasApiLabel(host)) return false;
  return exact || providerForHost(host) !== undefined || hasApiLabel(host) || isGateway(host);
}

/** Top-level domains a host written without a scheme may end with: `api.ok.py` is a file, `api.ok.com` a host. */
const BARE_TLDS = new Set(["com", "io", "ai", "org", "net", "co", "dev", "app", "cloud", "xyz", "tech", "us", "uk", "de", "fr", "eu", "cn", "jp", "in", "br", "au", "ca"]);

/**
 * A host written without a scheme (`hostname: "api.acme.com"`): a known provider host or LLM gateway, or an `api` label
 * under a common top-level domain. Module paths and file names (`api.client.py`) look the same, so nothing else counts.
 */
export function isBareApiHost(host: string, path: string): boolean {
  if (!isApiHost(host, path)) return false;
  return providerForHost(host) !== undefined || isGateway(host) || (hasApiLabel(host) && BARE_TLDS.has(host.slice(host.lastIndexOf(".") + 1)));
}
