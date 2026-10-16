import { describe, expect, it } from "vitest";
import { isApiHost } from "../../src/hosts/api-host.js";
import { calleeRole, calleeSegments, keyRole } from "../../src/hosts/context.js";
import { hostsInLiteral } from "../../src/hosts/literals.js";
import { hasPlaceholderSegment, isDocsPath, isNoCallPath } from "../../src/hosts/url-noise.js";

const hosts = (literal: string, role?: "text" | "link" | "weak"): string[] => hostsInLiteral(literal, role).map((m) => m.host);

describe("isNoCallPath: OAuth authorization pages and scopes", () => {
  it.each([
    ["accounts.google.com", "/o/oauth2/v2/auth?client_id=x&redirect_uri=y"],
    ["accounts.google.com", "/o/oauth2/auth"],
    ["login.microsoftonline.com", "/common/oauth2/v2.0/authorize"],
    ["login.microsoftonline.com", "/{tenant}/oauth2/authorize"],
    ["www.paypal.com", "/webapps/auth/protocol/openidconnect/v1/authorize"],
    ["github.com", "/login/oauth/authorize"],
    ["slack.com", "/oauth/v2/authorize"],
    ["acme.auth0.com", "/authorize"],
    ["discord.com", "/api/oauth2/authorize"],
    ["sso.acme.io", "/realms/x/protocol/openid-connect/auth"],
    ["api.twitter.com", "/oauth/authenticate"],
    ["id.acme.io", "/v1/start?response_type=code&client_id=x"],
    ["www.googleapis.com", "/auth/drive.readonly"],
    ["graph.microsoft.com", "/User.Read"],
    ["graph.microsoft.com", "/.default"],
  ])("leaves out %s%s", (host, path) => {
    expect(isNoCallPath(host, path)).toBe(true);
    expect(isApiHost(host, path)).toBe(false);
  });

  it.each([
    ["oauth2.googleapis.com", "/token"],
    ["www.googleapis.com", "/oauth2/v4/token"],
    ["github.com", "/login/oauth/access_token"],
    ["login.microsoftonline.com", "/common/oauth2/v2.0/token"],
    ["oauth2.googleapis.com", "/device/code"],
    ["api-m.paypal.com", "/v2/checkout/orders/{id}/authorize"],
    ["api.paypal.com", "/v1/identity/openidconnect/tokenservice"],
    ["api.acme.com", "/v1/payments/authorize"],
    ["graph.microsoft.com", "/v1.0/me"],
    ["www.googleapis.com", "/drive/v3/files"],
  ])("keeps %s%s", (host, path) => {
    expect(isNoCallPath(host, path)).toBe(false);
    expect(isApiHost(host, path)).toBe(true);
  });
});

describe("isNoCallPath: docs pages and placeholders", () => {
  it("reads a docs page by its first segment, after a locale; anywhere only when asked", () => {
    expect(isDocsPath("/robots")).toBe(true);
    expect(isDocsPath("/reference/block-kit/blocks")).toBe(true);
    expect(isDocsPath("/en-us/docs/api")).toBe(true);
    expect(isDocsPath("/v1/help/configuration")).toBe(false);
    expect(isDocsPath("/v1/help/configuration", true)).toBe(true);
    expect(isDocsPath("/v1/documents")).toBe(false);
    expect(isApiHost("api.slack.com", "/robots")).toBe(false);
    expect(isApiHost("api.slack.com", "/api/chat.postMessage")).toBe(true);
  });

  it("leaves out a generic cloud endpoint with a segment to fill in", () => {
    expect(hasPlaceholderSegment("sqs.us-east-1.amazonaws.com", "/your-account-id")).toBe(true);
    expect(hasPlaceholderSegment("sqs.us-east-1.amazonaws.com", "/123456789012/my-queue")).toBe(true);
    expect(hasPlaceholderSegment("pubsub.googleapis.com", "/v1/projects/YOUR_PROJECT/topics/x")).toBe(true);
    expect(hasPlaceholderSegment("acme.blob.core.windows.net", "/{your_container}")).toBe(true);
    expect(hasPlaceholderSegment("sqs.us-east-1.amazonaws.com", "/{account}/{queue}")).toBe(false);
    expect(hasPlaceholderSegment("pubsub.googleapis.com", "/v1/projects/acme-prod/topics/x")).toBe(false);
    expect(isApiHost("sqs.us-east-1.amazonaws.com", "/your-account-id")).toBe(false);
  });

  it("keeps a placeholder elsewhere: such a URL is often the one a call sends", () => {
    expect(hasPlaceholderSegment("hooks.slack.com", "/services/T000/B000/XXXX")).toBe(false);
    expect(hasPlaceholderSegment("api.acme.com", "/v1/projects/YOUR_PROJECT/items")).toBe(false);
    expect(isApiHost("hooks.slack.com", "/services/T000/B000/XXXX")).toBe(true);
  });
});

describe("hostsInLiteral: links and templates for a person", () => {
  it("leaves out Markdown, Slack and HTML links", () => {
    expect(hosts("Maybe <https://api.slack.com/surfaces/modals|*learn more*>")).toEqual([]);
    expect(hosts("See [the API](https://api.acme.com/v1/x) and <https://api.acme.com/v2>")).toEqual([]);
    expect(hosts('<a href="https://api.acme.com/v1">docs</a>')).toEqual([]);
    expect(hosts("curl https://api.telegram.org/bot<TOKEN>/getMe")).toEqual(["api.telegram.org"]);
    expect(hosts("POST https://api.acme.com/v1/x (see <https://api.other.com/v1>)")).toEqual(["api.acme.com"]);
  });

  it("reads a role: text and link literals name nothing, weak ones no docs page", () => {
    expect(hosts("https://api.acme.com/v1", "text")).toEqual([]);
    expect(hosts("https://api.acme.com/v1", "link")).toEqual([]);
    expect(hosts("https://api.acme.com/v1/help/x", "weak")).toEqual([]);
    expect(hosts("https://api.acme.com/v1/orders", "weak")).toEqual(["api.acme.com"]);
    expect(hosts("https://api.acme.com/v1/help/x")).toEqual(["api.acme.com"]);
  });
});

describe("calleeRole", () => {
  it("normalizes callees", () => {
    expect(calleeSegments("$this->logger->info")).toEqual(["logger", "info"]);
    expect(calleeSegments("logger()->warning")).toEqual(["logger", "warning"]);
    expect(calleeSegments("log::info!")).toEqual(["log", "info!"]);
    expect(calleeSegments("this.log")).toEqual(["log"]);
  });

  it.each([
    "console.log", "console.error", "print", "println!", "eprintln!", "log::warn!", "tracing::info!", "fmt.Println", "fmt.Fprintf",
    "log.Printf", "System.out.println", "System.err.printf", "logger.info", "self._logger.debug", "LOGGER.warn", "requestLogger.error",
    "logging.warning", "Log.d", "Timber.e", "Log::info", "logger()->info", "$this->info", "$this->line", "info", "echo", "click.echo",
    "warnings.warn", "sys.stdout.write", "res.redirect", "window.open", "webbrowser.open", "Redirect::to", "redirect()->away",
    "new Error", "ValueError", "new IllegalStateException", "fmt.Errorf", "errors.New", ".expect", "anyhow!",
  ])("%s prints or shows text", (callee) => expect(calleeRole(callee)).toBe("text"));

  it.each(["chalk.green", "chalk.bold.red", "pc.cyan", "String.format", "fmt.Sprintf", "format!", '"see {}".format', "JSON.stringify"])(
    "%s formats",
    (callee) => expect(calleeRole(callee)).toBe("format"),
  );

  it.each(["fetch", "axios.get", "requests.post", "http.Get", "client.get", "window.fetch", "catalog.get", "dialog.open", "changeLog.add", "new URL"])(
    "%s is no text",
    (callee) => expect(calleeRole(callee)).toBeUndefined(),
  );
});

describe("keyRole", () => {
  it("leaves out link keys, whatever their siblings", () => {
    for (const k of ["homepage", "website", "docs", "documentation_url", "href", "link", "redirect_uri", "authorizationURL", "scopes"]) expect(keyRole(k, [])).toBe("link");
  });

  it("weakens a url among keys that are no request's, only in an object", () => {
    expect(keyRole("url", ["name", "pattern"])).toBe("weak");
    expect(keyRole("'url'", ["name"])).toBe("weak");
    expect(keyRole("url", ["method", "headers"])).toBeUndefined();
    expect(keyRole("URL", ["Method"])).toBeUndefined();
    expect(keyRole("url")).toBeUndefined();
    expect(keyRole("base_url", ["name"])).toBeUndefined();
  });
});
