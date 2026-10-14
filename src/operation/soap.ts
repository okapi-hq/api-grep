import type { ResolvedCall } from "../assemble.js";
import type { Operation } from "../report/schema.js";
import type { Shape } from "../types.js";
import { namesOf } from "./names.js";

/**
 * SOAP (#36): every operation goes to one service URL. A request is SOAP when it sends a `SOAPAction` header, a SOAP
 * 1.2 content type (`application/soap+xml`), or an XML body whose root is an `Envelope`. The operation is the
 * action's last segment (`http://example.com/Track` -> `Track`, from the header or the content type's `action=`), else
 * the first element inside the envelope's `Body`.
 */

const SOAP12_RE = /^\s*application\/soap\+xml\s*(?:;|$)/i;
const ACTION_PARAM_RE = /;\s*action\s*=\s*"?([^";]*)"?/i;

/** `http://example.com/Svc/Track`, `urn:Track`, `"Svc#Track"` -> `Track`; undefined for an empty action. */
export function soapActionName(action: string): string | undefined {
  const v = action.trim().replace(/^"(.*)"$/, "$1");
  return v.split(/[/#:]/).filter((s) => s.trim() !== "").pop()?.trim();
}

const localName = (key: string): string => key.slice(key.lastIndexOf(":") + 1);

function child(s: Shape | undefined, name: string): Shape | undefined {
  if (s?.type !== "object") return undefined;
  const key = Object.keys(s.properties).find((k) => localName(k) === name);
  return key === undefined ? undefined : s.properties[key];
}

/** The body is an XML document whose root is a SOAP `Envelope`. */
function envelopeOf(r: ResolvedCall): Shape | undefined {
  const s = r.body.shape;
  if (r.body.encoding !== "xml" || s?.type !== "object" || Object.keys(s.properties).length !== 1) return undefined;
  return child(s, "Envelope");
}

/** The local name of the first element inside the envelope's `Body`. */
function bodyElement(envelope: Shape | undefined): string | undefined {
  const body = child(envelope, "Body");
  const first = body?.type === "object" ? Object.keys(body.properties)[0] : undefined;
  return first === undefined ? undefined : localName(first);
}

interface ActionNames {
  names: string[];
  /** Some value of the header could not be read (a branch the scan could not follow). */
  dynamic: boolean;
}

/** Every action name the `SOAPAction` header can take: its literal value, or each one a branch gives. */
function headerNames(r: ResolvedCall): ActionNames {
  const literal = r.headers.values.soapaction;
  const values = r.headers.alternatives?.soapaction ?? (typeof literal === "string" ? [literal] : []);
  const names = [...new Set(values.map(soapActionName).filter((n): n is string => !!n))];
  return { names, dynamic: names.length > 0 && literal === null };
}

/** SOAP 1.2 carries the action in the content type: `application/soap+xml; action="urn:Track"`. */
function contentTypeNames(contentType: string | null | undefined): ActionNames {
  const action = contentType ? ACTION_PARAM_RE.exec(contentType)?.[1] : undefined;
  const name = action ? soapActionName(action) : undefined;
  return { names: name ? [name] : [], dynamic: false };
}

export function soapOperations(r: ResolvedCall): Operation[] {
  const contentType = r.headers.values["content-type"];
  const hasHeader = r.headers.names.includes("soapaction");
  const envelope = envelopeOf(r);
  if (!hasHeader && !envelope && !(contentType && SOAP12_RE.test(contentType))) return [];
  const header = headerNames(r);
  const action = header.names.length > 0 ? header : contentTypeNames(contentType);
  const [name, ...others] = action.names;
  if (name) return [{ protocol: "soap", name, ...(others.length > 0 ? { alternatives: action.names } : {}), dynamic: action.dynamic, from: "header" }];
  const element = bodyElement(envelope);
  if (element) return [{ protocol: "soap", name: element, dynamic: false, from: "body" }];
  return [{ protocol: "soap", name: null, dynamic: true, from: hasHeader ? "header" : "body" }];
}

/**
 * The operation a SOAP client library's call sends (#58): the method called on the client (`$client->Track()`,
 * `client.service.Track()`, `client.TrackAsync()`), or the name given to `__soapCall`. The library writes it as the
 * first element of the envelope's `Body`.
 */
export function soapClientOperation(name: string | Shape | undefined): Operation {
  if (typeof name === "string") return { protocol: "soap", name, dynamic: false, from: "body" };
  const acc = name ? namesOf(name) : { names: [], dynamic: true };
  return { protocol: "soap", name: acc.names[0] ?? null, ...(acc.names.length > 1 ? { alternatives: acc.names } : {}), dynamic: acc.dynamic, from: "body" };
}
