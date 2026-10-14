import { statSync } from "node:fs";
import { readConfigFile } from "../files.js";
import { xmlTags } from "./xml-shape.js";

/**
 * A WSDL file of the scanned repository (#58): the service address it declares and its operation names. It is
 * hostile input like any file of the repository: read through `readConfigFile` (inside the scanned directory, a
 * regular file), capped in size and tags, and read with the XML tokenizer of `xml-shape.ts` (no DTD, no entities).
 * A WSDL given by URL is never fetched.
 */
export interface Wsdl {
  /** The one http(s) address its ports declare (`soap:address location`); undefined when none, or several differ. */
  address?: string;
  /** Operation names (`portType` and `binding` operations) by their lower case: PHP matches them in any case. */
  operations: Map<string, string>;
}

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_TAGS = 20_000;
const MAX_ADDRESS = 2048;
const MAX_CACHED = 64;
/** An http(s) URL with a plain host name (an entity reference such as `&h;` stays unexpanded, so it is not one). */
const ADDRESS_RE = /^https?:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#]\S*)?$/i;

const localName = (name: string): string => name.slice(name.lastIndexOf(":") + 1);

/** WSDL 1.1 `<soap:address location>` (also `soap12:`, `http:`), WSDL 2.0 `<endpoint address>`. */
function addressOf(name: string, attrs: Map<string, string>): string | undefined {
  const local = localName(name);
  if (local === "address") return attrs.get("location");
  return local === "endpoint" ? attrs.get("address") : undefined;
}

export function parseWsdl(text: string): Wsdl | undefined {
  if (text.length > MAX_TEXT) return undefined;
  const operations = new Map<string, string>();
  const addresses = new Set<string>();
  for (const tag of xmlTags(text, MAX_TAGS)) {
    const op = localName(tag.name) === "operation" ? tag.attrs.get("name") : undefined;
    if (op && /^[A-Za-z_][\w.-]*$/.test(op)) operations.set(op.toLowerCase(), op);
    const address = addressOf(tag.name, tag.attrs)?.trim();
    if (address && address.length <= MAX_ADDRESS && ADDRESS_RE.test(address)) addresses.add(address);
  }
  if (operations.size === 0 && addresses.size === 0) return undefined;
  return { address: addresses.size === 1 ? [...addresses][0] : undefined, operations };
}

const cache = new Map<string, Wsdl | undefined>();

/** The WSDL at `file`, when it is a readable file below `rootDir`; read once per version of the file. */
export function readWsdl(file: string, rootDir: string): Wsdl | undefined {
  let st;
  try {
    st = statSync(file, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
  if (!st?.isFile()) return undefined;
  const key = `${file}\0${st.mtimeMs}\0${st.size}`;
  if (cache.has(key)) return cache.get(key);
  const text = readConfigFile(file, rootDir);
  const wsdl = text === undefined ? undefined : parseWsdl(text);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(key, wsdl);
  return wsdl;
}
