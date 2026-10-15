import { staticText } from "../../resolve/parts.js";
import type { Part } from "../../types.js";
import { UNQUOTED } from "./argv.js";
import { dropPrefix, emptyRequest, leadingText, looksLikeUrl, splitParts, urlsOf, withScheme, type DataItem, type ShellRequest } from "./request.js";

/** Short options that take a value (`-X POST`, `-XPOST`, `-sSo out`). */
const VALUED_SHORT = new Set("AbcCdDeEFHKmorTuUwxXyYzPQt".split(""));

/** Long options that take a value; any other is a flag. */
const VALUED_LONG = new Set(
  (
    "abstract-unix-socket alt-svc aws-sigv4 cacert capath cert cert-type ciphers config connect-timeout connect-to " +
    "continue-at cookie cookie-jar create-file-mode crlfile curves data data-ascii data-binary data-raw " +
    "data-urlencode delegation dns-interface dns-ipv4-addr dns-ipv6-addr dns-servers doh-url dump-header ech " +
    "egd-file engine etag-compare etag-save expect100-timeout form form-string ftp-account ftp-alternative-to-user " +
    "ftp-method ftp-port ftp-ssl-ccc-mode happy-eyeballs-timeout-ms haproxy-clientip header hostpubmd5 " +
    "hostpubsha256 hsts interface ip-tos ipfs-gateway json keepalive-cnt keepalive-time key key-type krb libcurl " +
    "limit-rate local-port login-options mail-auth mail-from mail-rcpt max-filesize max-redirs max-time netrc-file " +
    "noproxy oauth2-bearer output output-dir parallel-max pass pinnedpubkey preproxy proto proto-default " +
    "proto-redir proxy proxy-cacert proxy-capath proxy-cert proxy-cert-type proxy-ciphers proxy-crlfile " +
    "proxy-header proxy-key proxy-key-type proxy-pass proxy-pinnedpubkey proxy-service-name proxy-tls13-ciphers " +
    "proxy-tlsauthtype proxy-tlspassword proxy-tlsuser proxy-user proxy1.0 pubkey quote random-file range rate " +
    "referer request request-target resolve retry retry-delay retry-max-time sasl-authzid service-name socks4 " +
    "socks4a socks5 socks5-gssapi-service socks5-hostname speed-limit speed-time stderr tls-max tls13-ciphers " +
    "tlsauthtype tlspassword tlsuser trace trace-ascii trace-config unix-socket upload-file url url-query user " +
    "user-agent variable vlan-priority write-out"
  ).split(" "),
);

const SHORT_LONG: Record<string, string> = {
  A: "user-agent",
  b: "cookie",
  d: "data",
  e: "referer",
  F: "form",
  G: "get",
  H: "header",
  I: "head",
  K: "config",
  T: "upload-file",
  u: "user",
  X: "request",
  ":": "next",
};

const DATA_KINDS: Record<string, DataItem["kind"]> = {
  data: "raw",
  "data-ascii": "raw",
  "data-raw": "raw",
  "data-binary": "binary",
  "data-urlencode": "urlencode",
  json: "json",
};

/** Headers some options set: `-A` the user agent, `-e` the referer, `-b name=value` cookies. */
const HEADER_OPTIONS: Record<string, string> = { "user-agent": "user-agent", referer: "referer", cookie: "cookie" };

interface CurlState {
  req: ShellRequest;
  urls: Part[][];
  get: boolean;
  head: boolean;
  basicLike: boolean;
  config: boolean;
}

/** `@file` data: curl reads the file (`-d @payload.json`); `--data-raw` never does. */
function dataItem(kind: DataItem["kind"], value: Part[], raw: boolean): DataItem {
  const text = leadingText(value);
  if (!raw && kind !== "urlencode" && text.startsWith("@")) return { kind, parts: [], file: dropPrefix(value, 1) };
  return { kind, parts: value };
}

function formItem(state: CurlState, value: Part[], literal: boolean): void {
  const [name, rest] = splitParts(value, "=", 1);
  const key = name ? staticText(name) : undefined;
  if (!key || !rest) return;
  const lead = leadingText(rest);
  const file = !literal && (lead.startsWith("@") || lead.startsWith("<"));
  state.req.form.push({ name: key, value: file ? dropPrefix(rest, 1) : rest, file });
}

function option(state: CurlState, name: string, value: Part[]): void {
  const { req } = state;
  const kind = DATA_KINDS[name];
  if (kind) req.data.push(dataItem(kind, value, name === "data-raw"));
  else if (name === "request") req.method = value;
  else if (name === "header" && !leadingText(value).startsWith("@")) req.headers.push(value);
  else if (HEADER_OPTIONS[name] && (name !== "cookie" || leadingText(value).includes("="))) req.headers.push([{ kind: "static", text: `${HEADER_OPTIONS[name]}: ` }, ...value]);
  else if (name === "form" || name === "form-string") formItem(state, value, name === "form-string");
  else if (name === "url") state.urls.push(value);
  else if (name === "url-query") req.query.push(value);
  else if (name === "upload-file") {
    req.implied = "PUT";
    req.data.push({ kind: "binary", parts: [], file: value });
  }
  else if (name === "user") req.auth = "basic";
  else if (name === "oauth2-bearer") req.auth = "bearer";
  else if (name === "aws-sigv4") req.auth = "unknown";
  else if (name === "config") req.opaque = state.config = true;
}

function flag(state: CurlState, name: string): void {
  if (name === "get") state.get = true;
  else if (name === "head") state.head = true;
  else if (name === "digest" || name === "ntlm" || name === "negotiate" || name === "anyauth") state.basicLike = false;
}

/** One short-option cluster (`-sSL`, `-XPOST`, `-sX` with its value next); returns how many arguments it used. */
function shortCluster(state: CurlState, arg: Part[], next: Part[] | undefined): number {
  const text = leadingText(arg);
  for (let j = 1; j < text.length; j++) {
    const c = text[j]!;
    const long = SHORT_LONG[c] ?? c;
    if (!VALUED_SHORT.has(c)) {
      flag(state, long);
      continue;
    }
    const attached = dropPrefix(arg, j + 1);
    if (attached.length > 0) option(state, long, attached);
    else if (next) option(state, long, next);
    return attached.length > 0 ? 1 : 2;
  }
  return 1;
}

function longOption(state: CurlState, arg: Part[], next: Part[] | undefined): number {
  const text = staticText(arg) ?? leadingText(arg);
  const eq = text.indexOf("=");
  const name = text.slice(2, eq > 0 ? eq : undefined);
  if (!VALUED_LONG.has(name)) {
    flag(state, name);
    return 1;
  }
  if (eq > 0) option(state, name, dropPrefix(arg, eq + 1));
  else if (next) option(state, name, next);
  return eq > 0 ? 1 : 2;
}

/** The method, from `-X`, else what `-I`, `-G`, `-T` and data imply. */
function impliedMethod(state: CurlState): string {
  const { req } = state;
  if (state.head) return "HEAD";
  if (state.get) return "GET";
  if (req.implied) return req.implied;
  return req.data.length > 0 || req.form.length > 0 ? "POST" : "GET";
}

/** A curl command line: one request per URL it names (at most five). */
export function parseCurl(args: Part[][], opaque: boolean): ShellRequest[] {
  const state: CurlState = { req: { ...emptyRequest("curl"), opaque }, urls: [], get: false, head: false, basicLike: true, config: false };
  for (let i = 0; i < args.length; ) {
    const arg = args[i]!;
    const lead = leadingText(arg);
    if (lead.startsWith("--") && lead.length > 2) i += longOption(state, arg, args[i + 1]);
    else if (lead.startsWith("-") && lead.length > 1) i += shortCluster(state, arg, args[i + 1]);
    else {
      if (looksLikeUrl(arg)) state.urls.push(arg);
      i++;
    }
  }
  const { req } = state;
  if (req.auth === "basic" && !state.basicLike) req.auth = "unknown";
  req.implied = impliedMethod(state);
  // `-G`: the data goes into the query string
  if (state.get) {
    req.query.push(...req.data.flatMap((d) => (d.file ? [] : splitParts(d.parts, "&"))));
    req.data = [];
  }
  if (req.data.some((d) => d.kind === "json")) req.headers.unshift([{ kind: "static", text: "content-type: application/json" }], [{ kind: "static", text: "accept: application/json" }]);
  // `-K file` / `--config <(...)`: the URL may be in the config, which the scan does not read
  if (state.urls.length === 0 && req.opaque && state.config) state.urls.push([{ kind: "dynamic", name: "url", origin: "unknown" }]);
  return urlsOf(state.urls, (a) => UNQUOTED.has(a))
    .slice(0, 5)
    .map((u) => ({ ...req, url: withScheme(u) }));
}
