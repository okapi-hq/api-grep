import { describe, expect, it } from "vitest";
import { neutralizeTemplates } from "../src/lang/html/templates.js";
import { parseHtml } from "../src/lang/html/extract.js";
import { at, scanFixture } from "./fixture-helpers.js";

describe("javascript: Node", () => {
  it("reads CommonJS requires, module.exports and ES modules through the type checker", async () => {
    const r = await scanFixture("javascript/node");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "javascript")).toBe(true);
    expect(at(r, "server.js", 10)).toMatchObject({ client: "sdk", provider: "stripe", pathTemplate: "/v1/checkout/sessions", sdk: { package: "stripe", version: "^14.0.0" } });
    expect(at(r, "server.js", 15)).toMatchObject({ client: "axios", provider: "github", host: "api.github.com", pathTemplate: "/users/{owner}/repos", query: ["per_page"] });
    expect(at(r, "server.js", 20)).toMatchObject({ provider: "slack", providerSource: "env-name", envName: "SLACK_WEBHOOK_URL", bodyEncoding: "json" });
    expect(at(r, "worker.mjs", 6)).toMatchObject({ provider: "openai", pathTemplate: "/v1/chat/completions" });
    expect(r.diagnostics?.languages).toEqual({ javascript: { filesSeen: 4, filesScanned: 4 } });
    expect(r.coverage?.sdks.map((s) => `${s.package}:${s.status}`)).toEqual(["openai:ok", "stripe:ok"]);
  });
});

describe("javascript: browser", () => {
  it("reads jQuery, XMLHttpRequest, globals loaded by a script tag and JSX", async () => {
    const r = await scanFixture("javascript/browser");
    expect(r).toMatchSnapshot();
    expect(at(r, "app.js", 4)).toMatchObject({ client: "jquery", method: "GET", query: ["term", "limit"], bodyEncoding: "none" });
    expect(at(r, "app.js", 10)).toMatchObject({ client: "jquery", provider: "convertkit", method: "POST", bodyEncoding: "json" });
    expect(at(r, "app.js", 19)).toMatchObject({ client: "jquery", provider: "internal", method: "POST", bodyEncoding: "form" });
    expect(at(r, "app.js", 28)).toMatchObject({ client: "xhr", provider: "cloudinary", method: "POST", bodyEncoding: "multipart", headers: ["x-requested-with"] });
    expect(at(r, "app.js", 32)).toMatchObject({ client: "axios", provider: "tmdb", query: ["query", "api_key"] });
    expect(at(r, "widget.jsx", 6)).toMatchObject({ client: "fetch", provider: "github", pathTemplate: "/repos/{repo}" });
  });
});

describe("html", () => {
  it("reads inline scripts at their position in the page, forms and CDN scripts", async () => {
    const r = await scanFixture("html/site");
    expect(r).toMatchSnapshot();
    expect(r.calls.every((c) => c.location.language === "html")).toBe(true);
    expect(at(r, "index.html", 9)).toMatchObject({ client: "html-form", provider: "formspree", method: "POST", bodyEncoding: "form", body: { required: ["email", "_subject"] } });
    expect(at(r, "index.html", 16)).toMatchObject({ client: "html-form", method: "GET", query: ["q"], bodyEncoding: "none" });
    expect(at(r, "index.html", 20)).toMatchObject({ provider: "internal", bodyEncoding: "multipart" });
    expect(at(r, "index.html", 33)).toMatchObject({ client: "sdk", provider: "supabase", host: "xyzcompany.supabase.co", pathTemplate: "/rest/v1/todos" });
    expect(at(r, "index.html", 38)).toMatchObject({ client: "axios", location: { col: 14 } });
    expect(at(r, "index.html", 43)).toMatchObject({ provider: "open-meteo" });
    expect(r.calls).toHaveLength(6);
    expect(r.coverage?.sdks.map((s) => `${s.package}:${s.status}:${s.importSites}`)).toEqual(["@supabase/supabase-js:ok:1"]);
  });

  it("reads server-side template tags as dynamic values", async () => {
    const r = await scanFixture("html/templates");
    expect(r.calls.map((c) => [c.location.line, c.client, c.method, c.urlTemplate])).toEqual([
      [10, "fetch", "POST", "https://api.posthog.example.com/admin"],
      [13, "jquery", "POST", "https://api.mailchimp.com/3.0/lists/abc/members"],
      [15, "fetch", "GET", "/api/users/{current_user_id}/stats"],
      [19, "fetch", "POST", "{config_API_URL}/v1/reports"],
      [20, "fetch", "GET", "{url}?page=2"],
    ]);
    expect(r.diagnostics?.complete).toBe(true);
  });

  it("keeps positions when it rewrites template tags", () => {
    const cases = ['const id = {{ user.id }};', 'fetch("{{ api_url }}/items")', "fetch(`{% url 'items' %}?q=1`)", "{% if a %}x(){% endif %}", "f('<?= $base ?>/x')"];
    for (const c of cases) expect(neutralizeTemplates(c)).toHaveLength(c.length);
    expect(neutralizeTemplates('fetch("{{ api_url }}/items")')).toBe('fetch(""+api_url  +"/items")');
    expect(neutralizeTemplates("const id = {{ user.id }};")).toBe("const id = user_id      ;");
  });

  it("keeps the page's line and column for every script character and ignores non-JavaScript scripts", () => {
    const page = '<p>\n  <script type="application/json">{"a":1}</script>\n  <script>fetch("/x")</script>';
    const doc = parseHtml(page);
    expect(doc.script).toHaveLength(page.length);
    expect(doc.script!.indexOf("fetch")).toBe(page.indexOf("fetch"));
    expect(doc.script).not.toContain('"a"');
  });
});
