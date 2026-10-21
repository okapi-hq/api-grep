import type { ResolvedCall } from "../assemble.js";
import type { Operation } from "../report/schema.js";
import type { MethodSpec } from "../types.js";

/** The operation that fetches an agent card: a `GET` of its URL, named by the path rather than a body. */
export const AGENT_CARD_OPERATION = "GetAgentCard";

/** Where an agent card is served under an agent's base URL (A2A 0.3 on; 0.2 read `/.well-known/agent.json`). */
export const AGENT_CARD_PATH = "/.well-known/agent-card.json";

/** A card's well-known path at the end of a URL path (either version's file name). */
const WELL_KNOWN_CARD = /\/\.well-known\/agent(?:-card)?\.json$/;

/**
 * A2A (Agent2Agent) client requests: what the SDK method performs, by A2A 1.0 names (`SendMessage`). The method an
 * SDK sends on the wire depends on its version (`message/send` before 1.0, `SendMessage` from it): `sdkVersion`
 * tells. A construction may perform several (an agent framework's remote agent fetches its card, then sends messages).
 */
export function a2aOperations(spec: MethodSpec | undefined): Operation[] {
  if (spec?.a2a === undefined) return [];
  const names = Array.isArray(spec.a2a) ? spec.a2a : [spec.a2a];
  return names.map((name) => ({ protocol: "a2a", name, dynamic: false, from: name === AGENT_CARD_OPERATION ? "path" : "body" }));
}

/** The operations of an A2A method after its first, which `ResolvedCall.moreOperations` carries. */
export const moreA2aOperations = (spec: MethodSpec | undefined): Pick<ResolvedCall, "moreOperations"> => {
  const more = a2aOperations(spec).slice(1);
  return more.length > 0 ? { moreOperations: more } : {};
};

/**
 * An A2A call's URL from the agent URL the code gives: the card's fetch is under its well-known path (unless the code
 * gives the card's own URL, a `.json` file), and the other operations go to the agent's base URL (the card's URL
 * without its well-known path). The card lists the interface URL requests really go to, which the code does not say.
 */
export function a2aUrl(r: ResolvedCall): ResolvedCall {
  if (r.operation?.protocol !== "a2a") return r;
  const path = r.url.pathTemplate;
  if (r.operation.name === AGENT_CARD_OPERATION) {
    const card = asCardFetch(r);
    return path.endsWith(".json") ? card : withPath(card, `${path.replace(/\/$/, "")}${AGENT_CARD_PATH}`);
  }
  return WELL_KNOWN_CARD.test(path) ? withPath(r, path.replace(WELL_KNOWN_CARD, "")) : r;
}

/** The card's fetch: a `GET` with no body, whatever the construction performing it sends next. */
function asCardFetch(r: ResolvedCall): ResolvedCall {
  const dynamic = r.dynamic.filter((d) => d.where !== "body");
  return { ...r, method: "GET", dynamic, body: { encoding: "none", dynamic: [], fromLiteral: false } };
}

/** The call with another path: the URL keeps its scheme, host and query. */
function withPath(r: ResolvedCall, pathTemplate: string): ResolvedCall {
  const raw = r.url.raw;
  const scheme = raw.indexOf("://");
  const from = scheme >= 0 ? scheme + 3 : 0;
  const slash = raw.indexOf("/", from);
  const query = raw.indexOf("?", from);
  const end = query >= 0 ? query : raw.length;
  const pathAt = slash >= 0 && slash < end ? slash : end;
  // an empty path reads `/`, as for any URL naming none; the URL keeps it empty
  return { ...r, url: { ...r.url, pathTemplate: pathTemplate || "/", raw: raw.slice(0, pathAt) + pathTemplate + raw.slice(end) } };
}
