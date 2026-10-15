import type { Part } from "../../types.js";
import { UNQUOTED } from "./argv.js";
import { dropPrefix, emptyRequest, leadingText, looksLikeUrl, urlsOf, withScheme, type ShellRequest } from "./request.js";

/** Short options that take a value (`-O out`, `-qO-`). */
const VALUED_SHORT = new Set("OoaPtTwUeiBQlARDIX".split(""));

const VALUED_LONG = new Set(
  (
    "output-document output-file append-output directory-prefix tries timeout dns-timeout connect-timeout " +
    "read-timeout wait waitretry user-agent execute input-file base quota level accept reject domains " +
    "exclude-domains include-directories exclude-directories header method body-data body-file post-data post-file " +
    "user password http-user http-password proxy-user proxy-password load-cookies save-cookies referer " +
    "ca-certificate ca-directory certificate certificate-type private-key private-key-type bind-address limit-rate " +
    "restrict-file-names progress local-encoding remote-encoding secure-protocol ciphers max-redirect " +
    "retry-on-http-error report-speed default-page accept-regex reject-regex regex-type config use-askpass"
  ).split(" "),
);

const SHORT_LONG: Record<string, string> = { U: "user-agent", e: "execute", i: "input-file" };

function option(req: ShellRequest, name: string, value: Part[]): void {
  if (name === "header") req.headers.push(value);
  else if (name === "user-agent") req.headers.push([{ kind: "static", text: "user-agent: " }, ...value]);
  else if (name === "referer") req.headers.push([{ kind: "static", text: "referer: " }, ...value]);
  else if (name === "method") req.method = value;
  else if (name === "post-data" || name === "body-data") req.data.push({ kind: "raw", parts: value });
  else if (name === "post-file" || name === "body-file") req.data.push({ kind: "binary", parts: [], file: value });
  else if (name === "user" || name === "http-user") req.auth = "basic";
  else if (name === "input-file" || name === "config" || name === "execute") req.opaque = true;
}

/** `-nv`, `-nc`, `-np`: two-letter flags; `-qO-`: flags, then an option taking the rest. */
function shortCluster(req: ShellRequest, arg: Part[], next: Part[] | undefined): number {
  const text = leadingText(arg);
  if (text.startsWith("-n") && text.length === 3) return 1;
  for (let j = 1; j < text.length; j++) {
    const c = text[j]!;
    if (!VALUED_SHORT.has(c)) continue;
    const attached = dropPrefix(arg, j + 1);
    const value = attached.length > 0 ? attached : next;
    if (value) option(req, SHORT_LONG[c] ?? c, value);
    return attached.length > 0 ? 1 : 2;
  }
  return 1;
}

function longOption(req: ShellRequest, arg: Part[], next: Part[] | undefined): number {
  const text = leadingText(arg);
  const eq = text.indexOf("=");
  const name = text.slice(2, eq > 0 ? eq : undefined);
  if (!VALUED_LONG.has(name)) return 1;
  if (eq > 0) option(req, name, dropPrefix(arg, eq + 1));
  else if (next) option(req, name, next);
  return eq > 0 ? 1 : 2;
}

/** A wget command line: one request per URL (at most five); `--post-data` and `--post-file` make it a POST. */
export function parseWget(args: Part[][], opaque: boolean): ShellRequest[] {
  const req: ShellRequest = { ...emptyRequest("wget"), opaque };
  const urls: Part[][] = [];
  for (let i = 0; i < args.length; ) {
    const arg = args[i]!;
    const lead = leadingText(arg);
    if (lead.startsWith("--") && lead.length > 2) i += longOption(req, arg, args[i + 1]);
    else if (lead.startsWith("-") && lead.length > 1) i += shortCluster(req, arg, args[i + 1]);
    else {
      if (looksLikeUrl(arg)) urls.push(arg);
      i++;
    }
  }
  req.implied = req.data.length > 0 ? "POST" : "GET";
  return urlsOf(urls, (a) => UNQUOTED.has(a))
    .slice(0, 5)
    .map((u) => ({ ...req, url: withScheme(u) }));
}
