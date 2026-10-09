import { isSafeKey } from "../record-keys.js";
import type { HostKind } from "../types.js";
import data from "./providers.json" with { type: "json" };

export interface ProviderInfo {
  id: string;
  name: string;
  /** Exact hosts; a leading dot matches any subdomain (`.supabase.co`). */
  hosts: string[];
  /** npm packages that talk to this provider. */
  packages?: string[];
  category?: string;
}

/** How `provider` was found: an SDK registry, the host, or (weakest) the name of the env var holding the URL. */
export type ProviderSource = "sdk" | "host" | "env-name";

export const PROVIDERS: ProviderInfo[] = data.providers;

const EXACT = new Map<string, string>();
const SUFFIXES: [string, string][] = [];
for (const p of PROVIDERS) {
  for (const h of p.hosts) {
    if (h.startsWith(".")) SUFFIXES.push([h, p.id]);
    else if (!EXACT.has(h)) EXACT.set(h, p.id);
  }
}
SUFFIXES.sort((a, b) => b[0].length - a[0].length);

/** Provider of a host: an exact host first, then the longest matching suffix (`maps.googleapis.com` before `.googleapis.com`). */
export function providerForHost(host: string | undefined): string | undefined {
  if (!host || host.includes("{")) return undefined;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return EXACT.get(h) ?? SUFFIXES.find(([suffix]) => h.endsWith(suffix))?.[1];
}

const ENV_PREFIX = /^(?:NEXT_PUBLIC_|NUXT_PUBLIC_|EXPO_PUBLIC_|REACT_APP_|VITE_|PUBLIC_|NG_APP_)/;
const ENV_SUFFIX = /_(?:API_BASE_URL|BASE_URL|API_URL|ENDPOINT_URL|API_ENDPOINT|ENDPOINT|API_HOST|HOST|HOSTNAME|URL|URI|API_BASE|BASE|DOMAIN)$/;
/** Words that still name the provider's own service (`SLACK_WEBHOOK_URL`); `GITHUB_CALLBACK_URL` is the app's URL, not GitHub's. */
const SERVICE_WORDS = /_(?:WEBHOOK|API|PROXY|GATEWAY|REST|GRAPHQL|INFERENCE|INGEST|EVENTS|FUNCTIONS)$/;

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map<string, string>();
for (const p of PROVIDERS) for (const key of [p.id, p.name]) if (!BY_NAME.has(normalize(key))) BY_NAME.set(normalize(key), p.id);

/** `OPENROUTER_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SLACK_WEBHOOK_URL` -> the provider they name, if it is a known one. */
export function providerFromEnvName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const core = name.toUpperCase().replace(ENV_PREFIX, "").replace(ENV_SUFFIX, "");
  const exact = BY_NAME.get(normalize(core));
  if (exact || !SERVICE_WORDS.test(core)) return exact;
  // `SLACK_FEEDBACK_WEBHOOK_URL`: a webhook / API of the provider its first word names
  return BY_NAME.get(normalize(core.replace(SERVICE_WORDS, ""))) ?? BY_NAME.get(normalize(core.split("_")[0]!));
}

export interface ProviderInput {
  hostKind: HostKind;
  host?: string;
  envName?: string;
  sdkProvider?: string;
}

export interface ResolvedProvider {
  provider: string;
  source?: ProviderSource;
}

/**
 * Provider of a call. Never a raw template: a host that still holds a placeholder (`{hostname}:443`) gives `internal`
 * (localhost), the provider named by its env var, `env:<NAME>` or `unknown`.
 */
export function resolveProvider(input: ProviderInput): ResolvedProvider {
  if (input.sdkProvider) return { provider: input.sdkProvider, source: "sdk" };
  const local = localService(input.host);
  if (local) return { provider: local, source: "host" };
  if (input.hostKind === "relative" || isLocalhost(input.host)) return { provider: "internal" };
  const known = providerForHost(input.host);
  if (known) return { provider: known, source: "host" };
  const envName = input.envName ?? /\{env:([^}]+)\}/.exec(input.host ?? "")?.[1];
  const byName = providerFromEnvName(envName);
  if (byName) return { provider: byName, source: "env-name" };
  if (input.host && HOST_RE.test(input.host) && isSafeKey(input.host)) return { provider: input.host };
  if (envName) return { provider: `env:${envName}` };
  return { provider: "unknown" };
}

/** A host that can name a provider by itself: `api.example.com`, `billing:8080` (no placeholder, no odd characters). */
const HOST_RE = /^[a-z0-9._-]+(?::\d+)?$/i;

/** Self-hosted model servers on their default port: `localhost:11434` is Ollama, `:8188` ComfyUI. */
const LOCAL_PORTS: Record<string, string> = { "11434": "ollama", "8188": "comfyui" };

function localService(host: string | undefined): string | undefined {
  const port = host && isLocalhost(host) ? /:(\d+)$/.exec(host)?.[1] : undefined;
  return port ? LOCAL_PORTS[port] : undefined;
}

/** `localhost`, `127.0.0.1:3000`, `localhost:{port}`, `api.local`. */
export function isLocalhost(host: string | undefined): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  const bracketed = /^\[([^\]]+)\]/.exec(lower)?.[1];
  const h = bracketed ?? (lower.startsWith("::") ? lower : lower.split(":")[0]!);
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") || h.endsWith(".localhost");
}
