/**
 * Where a string literal sits, for `coverage.hosts`: each front end reads the call or the key around a literal and asks
 * here what it makes of it, by name, the same for every language.
 *
 * - `text`: an argument of a logging or printing call, an error's message, or a URL handed to a browser
 *   (`res.redirect`, `window.open`): text for a person, never a call; the literal is not read.
 * - `link`: the value of a key that names a page (`homepage`, `docs`, `href`, `redirect_uri`, `scope`): not read.
 * - `weak`: the value of `url` or `uri` in an object with no request-like key beside it (`{ name, url }`, a list of
 *   bots or services): read, but a URL with a documentation segment anywhere in its path is not counted.
 */
export type LiteralRole = "text" | "link" | "weak";

/** What a call does with its arguments: shows them to a person (`text`), or formats them into its result (`format`). */
export type CalleeRole = "text" | "format";

/**
 * A callee as written (`$this->logger->info`, `log::info!`, `Log::info`, `logger()->warning`, `this.log`) as dotted
 * segments, with calls in the chain, `this` and `self` dropped: `logger.info`, `log.info!`, `Log.info`, `log`.
 */
export function calleeSegments(raw: string): string[] {
  let s = raw.replace(/\s+/g, "").replace(/\$/g, "");
  for (let prev = ""; prev !== s; ) [prev, s] = [s, s.replace(/\([^()]*\)/g, "")];
  s = s.replace(/\?->|->|::|\?\.|!!\./g, ".").replace(/<[^<>]*>/g, "");
  const segs = s.split(".").filter((x) => x.length > 0);
  while (segs.length > 1 && /^(?:this|self|static|parent|cls|it)$/.test(segs[0]!)) segs.shift();
  return segs;
}

/** Functions that print or log what they are given, called without a receiver (`print`, `println!`, `info`, `dd`). */
const BARE_TEXT = /^(?:e?print(?:ln|f)?!?|echo|puts|var_dump|print_r|var_export|dd|dump|error_log|alert|die|log|logger|info!?|warn(?:ing)?!?|error!?|debug!?|trace!?|notice|panic!|unreachable!|todo!|unimplemented!|comment|line|question)$/;
/** Methods that print whatever their receiver (`fmt.Println`, `System.out.printf`, `click.echo`, `this.log`). */
const PRINT_METHOD = /^(?:e?print(?:ln|f)?!?|f?print(?:ln|f)?|echo|secho|puts|log)$/i;
/** Receivers whose every method logs or prints: consoles, loggers, standard streams (`console`, `self._logger`, `LOG`, `Log` on Android, `log::` macros). */
const LOGGER =
  /^(?:console|logging|warnings|slog|logrus|zap|zerolog|[tT]imber|tracing|winston|pino|bunyan|signale|consola|log4js|_*[lL]og(?:ger)?|_*(?:[a-z0-9]+_)+log(?:ger)?|_*[a-z][A-Za-z0-9]*Logger|LOG(?:GER)?|[A-Z0-9_]+_LOG(?:GER)?|[sS]td(?:out|err))$/;
/** Errors, whose message is text for a person (`new Error("...")`, `raise ValueError(...)`, `fmt.Errorf`, `.expect("...")`, `bail!`). */
const ERROR = /^(?:new)?\w*(?:Error|Exception)$|^(?:errorf|Errorf|expect|anyhow!|bail!|ensure!|abort(?:_if|_unless)?)$/;

/** URLs handed to a browser: redirects, a new window, the system's browser. */
const NAVIGATE_METHOD = /^(?:redirect(?:_to|To)?|away|open_new(?:_tab)?|openURL|openUrl|openExternal|launchUrl)$/i;
const NAVIGATE = /^(?:window\.open|location\.(?:assign|replace)|webbrowser\.\w+|Linking\.\w+|open\.that|Redirect\.\w+)$/;
/** Calls whose result is their arguments formatted or colored, so a log call around them still prints them. */
const FORMAT_METHOD =
  /^(?:format!?|format_args!|s?printf|[sS]print(?:ln|f)?|join|concat|dedent|stripIndent|stringify|dumps|str|String|toString|to_string|to_owned|into|trim|strip|bold|dim|italic|underline|inverse|red|green|yellow|blue|magenta|cyan|white|gr[ae]y|black|colou?red|style)$/;
const FORMAT_RECEIVER = /^(?:chalk|kleur|colou?rs|colorette|picocolors|pc|ansis|kolorist|clc|ansi|termcolor|Fore|Style|styles?)$/;

/** What a call (its callee as written) does with its arguments, if anything host coverage cares about. */
export function calleeRole(raw: string): CalleeRole | undefined {
  const segs = calleeSegments(raw);
  const method = segs.at(-1);
  if (!method) return undefined;
  const receiver = segs.length > 1 ? segs.at(-2)! : undefined;
  if (receiver === undefined && BARE_TEXT.test(method)) return "text";
  if (PRINT_METHOD.test(method) || NAVIGATE_METHOD.test(method) || ERROR.test(method) || segs.join(".") === "errors.New") return "text";
  if (receiver !== undefined && (LOGGER.test(receiver) || NAVIGATE.test(`${receiver}.${method}`))) return "text";
  if (FORMAT_METHOD.test(method) || segs.some((s) => FORMAT_RECEIVER.test(s))) return "format";
  return undefined;
}

const keyOf = (key: string): string => key.replace(/^["'`]+|["'`]+$/g, "").toLowerCase().replace(/[-_\s]/g, "");

/** Keys naming a page a person opens, a browser's redirect or an OAuth scope: never a call's URL. */
const LINK_KEYS = new Set([
  "homepage", "homepageurl", "website", "websiteurl", "docs", "docsurl", "doc", "docurl", "documentation",
  "documentationurl", "docslink", "href", "link", "links", "info", "infourl", "moreinfo", "moreinfourl", "learnmore", "learnmoreurl",
  "helpurl", "helplink", "reference", "referenceurl", "termsurl", "privacyurl", "policyurl", "tosurl", "supporturl", "about", "abouturl",
  "scope", "scopes", "redirecturi", "redirecturl", "callbackurl", "callbackuri", "returnurl", "successurl", "cancelurl",
  "authorizationurl", "authorizeurl", "authorizationendpoint", "authorizeendpoint", "userauthorizationurl",
]);
const WEAK_KEYS = new Set(["url", "uri"]);
/** Keys of a request, its options or a client's configuration: beside them, a `url` is one the code calls. */
const REQUEST_KEYS = new Set([
  "method", "verb", "httpmethod", "headers", "header", "body", "data", "json", "params", "query", "qs", "form", "formdata", "payload",
  "baseurl", "baseuri", "endpoint", "host", "path", "auth", "authorization", "token", "apikey", "key", "secret", "clientid", "clientsecret",
  "credentials", "timeout", "contenttype", "accept", "model", "region", "proxy", "retries", "agent",
]);

/**
 * What the key a literal is the value of makes of it. `siblings` are the other keys of its object, undefined when the
 * literal is a named argument (`f(url="...")`): a call's own arguments are never weak.
 */
export function keyRole(key: string, siblings?: string[]): LiteralRole | undefined {
  const k = keyOf(key);
  if (LINK_KEYS.has(k)) return "link";
  if (!WEAK_KEYS.has(k) || siblings === undefined) return undefined;
  return siblings.some((s) => REQUEST_KEYS.has(keyOf(s))) ? undefined : "weak";
}
