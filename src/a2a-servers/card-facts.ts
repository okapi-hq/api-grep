import type { A2aCardFacts } from "../report/schema-a2a-servers.js";

/**
 * The card fields that tell a version, by their camel-case name: 1.0's `supportedInterfaces`, or the fields it replaced
 * (`protocolVersion` is in both, on the card before 1.0 and on each interface from it: `protocolVersions` has its values).
 */
const VERSION_FIELDS = ["supportedInterfaces", "preferredTransport", "additionalInterfaces", "supportsAuthenticatedExtendedCard"];

const BINDINGS: Record<string, string> = { JSONRPC: "JSONRPC", GRPC: "GRPC", "HTTP+JSON": "HTTP+JSON", HTTP_JSON: "HTTP+JSON" };

const snake = (camel: string): string => camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();

/** Every first group of `re` in `text`. */
const all = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1]!);

/** What a source file writes of a card, read as text: literal versions, bindings, the fields that tell the version. */
export function cardFactsInCode(text: string): A2aCardFacts {
  const versions = all(text, /\bprotocol_?[vV]ersion["']?\s*[:=]\s*["'](\d+(?:\.\d+)*)["']/g);
  const bindings = [
    ...all(text, /\b(?:protocol_?[bB]inding|preferred_?[tT]ransport|transport)["']?\s*[:=]\s*["'](JSONRPC|GRPC|HTTP\+JSON)["']/g),
    ...all(text, /\bTransportProtocol\.(JSONRPC|GRPC|HTTP_JSON|jsonrpc|grpc|http_json)\b/g).map((b) => b.toUpperCase()),
  ];
  const fields = VERSION_FIELDS.filter((f) => new RegExp(`\\b(?:${f}|${snake(f)})["']?\\s*[:=]`).test(text));
  return {
    protocolVersions: sorted(versions),
    bindings: sorted(bindings.map((b) => BINDINGS[b] ?? b)),
    fields: sorted(fields),
    cardPaths: sorted(all(text, /["'](\/?\.well-known\/agent(?:-card)?\.json)["']/g).map((p) => (p.startsWith("/") ? p : `/${p}`))),
  };
}

const record = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.flatMap((x): Record<string, unknown>[] => { const r = record(x); return r ? [r] : []; }) : []);
const text = (v: unknown): string[] => (typeof v === "string" && v.length <= 64 ? [v] : []);

/** What a committed agent card says, from its parsed JSON; undefined when it is no card (no object, no name). */
export function cardFactsOfJson(data: unknown, cardPath: string): A2aCardFacts | undefined {
  const card = record(data);
  if (!card || typeof card.name !== "string") return undefined;
  const interfaces = [...list(card.supportedInterfaces), ...list(card.additionalInterfaces)];
  const versions = [...text(card.protocolVersion), ...interfaces.flatMap((i) => text(i.protocolVersion))];
  const bindings = [...text(card.preferredTransport), ...interfaces.flatMap((i) => [...text(i.protocolBinding), ...text(i.transport)])];
  return {
    protocolVersions: sorted(versions),
    bindings: sorted(bindings.map((b) => BINDINGS[b] ?? b)),
    fields: sorted(VERSION_FIELDS.filter((f) => f in card)),
    cardPaths: [cardPath],
    name: card.name.slice(0, 200),
    ...(Array.isArray(card.skills) ? { skills: card.skills.length } : {}),
  };
}
