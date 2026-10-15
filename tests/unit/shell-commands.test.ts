import { describe, expect, it } from "vitest";
import type { Call } from "../../src/report/schema.js";
import { buildShellCall } from "../../src/lang/shell/build.js";
import { extractRequests } from "../../src/lang/shell/extract.js";
import { collectScope } from "../../src/lang/shell/scope.js";
import { parserFor } from "../../src/lang/tree-sitter.js";

/** The calls a script's commands send, built as the scan builds them. */
async function calls(code: string, wrappers = true): Promise<Call[]> {
  const parser = await parserFor("bash");
  const tree = parser.parse(code)!;
  try {
    const found = extractRequests(tree.rootNode, collectScope(tree.rootNode), wrappers);
    return found.flatMap((f) =>
      buildShellCall(f.req, { file: "s.sh", line: f.line, col: f.col, language: "shell" }, f.via, { envHints: {}, readFile: () => undefined }),
    );
  } finally {
    tree.delete();
    parser.delete();
  }
}

const one = async (code: string): Promise<Call> => {
  const all = await calls(code);
  expect(all).toHaveLength(1);
  return all[0]!;
};

const props = (c: Call): Record<string, unknown> => (c.body as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};

describe("shell: curl options", () => {
  it("reads the method from -X, -I, -G, -T and data options", async () => {
    expect((await one("curl -XPATCH https://api.example.org/a")).method).toBe("PATCH");
    expect((await one("curl -sSI https://api.example.org/a")).method).toBe("HEAD");
    expect((await one("curl -d a=1 https://api.example.org/a")).method).toBe("POST");
    expect((await one("curl -G -d a=1 https://api.example.org/a")).method).toBe("GET");
    expect((await one("curl -T f.bin https://api.example.org/a")).method).toBe("PUT");
    expect((await one("curl -F a=b https://api.example.org/a")).method).toBe("POST");
    expect((await one("curl --request DELETE https://api.example.org/a")).method).toBe("DELETE");
    expect((await one('curl -X "$VERB" https://api.example.org/a')).method).toBe("DYNAMIC");
  });

  it("finds the URL past options that take a value, and reads --url", async () => {
    const c = await one('curl -s -o out.json -w "%{http_code}" -m 10 --retry 3 -A agent https://api.example.org/v1/x');
    expect(c).toMatchObject({ urlTemplate: "https://api.example.org/v1/x", headers: ["user-agent"], headerValues: { "user-agent": "agent" } });
    expect((await one("curl --url https://api.example.org/u --compressed")).urlTemplate).toBe("https://api.example.org/u");
    // a URL without a scheme is http, as curl reads it
    expect((await one("curl api.example.org/ping")).urlTemplate).toBe("http://api.example.org/ping");
  });

  it("reads headers by name, keeps literal values, never credentials, and the auth scheme", async () => {
    const c = await one('curl -H "Authorization: Bearer $TOKEN" -H "X-Trace: on" -H "Cookie: s=1" https://api.example.org/a');
    expect(c).toMatchObject({ headers: ["authorization", "x-trace", "cookie"], authScheme: "bearer" });
    expect(c.headerValues).toEqual({ authorization: null, "x-trace": "on", cookie: null });
    expect((await one("curl -u user:secret https://api.example.org/a")).authScheme).toBe("basic");
    expect((await one("curl --digest -u user:secret https://api.example.org/a")).authScheme).toBe("unknown");
    expect((await one('curl --oauth2-bearer "$T" https://api.example.org/a')).authScheme).toBe("bearer");
    expect((await one('curl -H "x-api-key: $KEY" https://api.example.org/a')).authScheme).toBe("apikey");
  });

});

describe("shell: curl bodies", () => {
  it("reads JSON bodies with shell values written into them", async () => {
    const c = await one(`curl https://api.example.org/a -d '{"name": "'"$NAME"'", "count": '$COUNT', "on": true}'`);
    expect(c.bodyEncoding).toBe("json");
    expect(props(c)).toEqual({ name: { type: "string", env: "NAME" }, count: { type: "dynamic", origin: "env", hint: "COUNT" }, on: { type: "boolean", enum: [true] } });
    expect(c.dynamic).toEqual([
      { where: "body", name: "name", origin: "env" },
      { where: "body", name: "count", origin: "env" },
    ]);
  });

  it("reads form data, --data-urlencode, -F fields and -G query data", async () => {
    const form = await one('curl -d user=ada -d "note=$NOTE" --data-urlencode "q=a b" https://api.example.org/a');
    expect(form.bodyEncoding).toBe("form");
    expect(Object.keys(props(form))).toEqual(["user", "note", "q"]);
    const multipart = await one("curl -F file=@doc.pdf -F title=Doc https://api.example.org/a");
    expect(multipart).toMatchObject({ bodyEncoding: "multipart", body: { properties: { file: { type: "string" }, title: { enum: ["Doc"] } } } });
    const get = await one("curl -G --data-urlencode q=widgets -d limit=5 https://api.example.org/search");
    expect(get).toMatchObject({ method: "GET", bodyEncoding: "none", query: ["q", "limit"] });
  });

  it("sends --json as JSON with its headers, and a body it cannot read with the content type it names", async () => {
    const json = await one(`curl --json '{"a": 1}' https://api.example.org/a`);
    expect(json).toMatchObject({ method: "POST", bodyEncoding: "json", headerValues: { "content-type": "application/json", accept: "application/json" } });
    const opaque = await one('curl -H "Content-Type: application/json" -d "$PAYLOAD" https://api.example.org/a');
    expect(opaque).toMatchObject({ bodyEncoding: "json", body: { type: "dynamic", origin: "env" }, bodySource: "unknown" });
    const file = await one("curl -d @payload.json https://api.example.org/a");
    expect(file).toMatchObject({ body: { type: "unknown" }, bodySource: "unknown" });
  });

  it("reports one call per URL and nothing without a URL", async () => {
    expect((await calls("curl https://a.example.org/x https://b.example.org/y")).map((c) => c.host)).toEqual(["a.example.org", "b.example.org"]);
    // an unquoted value the scan cannot read is options as often as a URL: another URL wins
    expect((await one('curl ${CURL_OPTS} -s "$API_URL/v1"')).envName).toBe("API_URL");
    expect((await one("curl $URL")).envName).toBe("URL");
    expect(await calls("curl --version")).toEqual([]);
    // a config file may name the URL: the request is reported, its options unread
    expect(await one("curl -sS -K request.cfg")).toMatchObject({ hostKind: "unknown", optionsOpaque: true });
    expect(await calls('curl -s "$@"')).toEqual([]);
  });
});

describe("shell: variables", () => {
  it("reads assignments, export, readonly and local as constants, and the rest as env reads", async () => {
    const c = await one('export BASE="https://api.example.org/v2"\nreadonly KEY_HEADER="X-Api-Key"\ncurl "${BASE%/}/items/$ITEM_ID" -H "$KEY_HEADER: $API_KEY"');
    expect(c).toMatchObject({ hostKind: "const", host: "api.example.org", pathTemplate: "/v2/items/{ITEM_ID}", headers: ["x-api-key"], authScheme: "apikey" });
    const env = await one('curl "$SERVICE_URL/health"');
    expect(env).toMatchObject({ hostKind: "env", envName: "SERVICE_URL", provider: "env:SERVICE_URL" });
  });

  it("uses a default as the host, with the env var's name", async () => {
    const c = await one('API="${OPENAI_BASE_URL:-https://api.openai.com/v1}"\ncurl "$API/models"');
    expect(c).toMatchObject({ provider: "openai", host: "api.openai.com", hostKind: "env", envName: "OPENAI_BASE_URL", pathTemplate: "/v1/models" });
  });

  it("prefers a value over option parsing and empty initialisations", async () => {
    const c = await one('TOKEN=""\nwhile getopts t: o; do case $o in t) TOKEN="$OPTARG";; esac; done\n[ -z "$TOKEN" ] && TOKEN=$BOT_TOKEN\ncurl "https://api.telegram.org/bot$TOKEN/getMe"');
    expect(c.urlTemplate).toBe("https://api.telegram.org/bot{env:BOT_TOKEN}/getMe");
  });

  it("names values read at run time after their variable", async () => {
    const c = await one('ID=$(jq -r .id state.json)\nfor page in 1 2 3; do curl "https://api.example.org/items/$ID?page=$page"; done');
    expect(c.dynamic).toEqual([
      { where: "query", name: "page", origin: "param" },
      { where: "path", name: "ID", origin: "call" },
    ]);
  });

  it("expands arrays of options and a command kept in a variable", async () => {
    const c = await one('HEADERS=(-H "Accept: application/json" -H "Authorization: token $GH_TOKEN")\nCURL="curl -fsS"\n$CURL "${HEADERS[@]}" https://api.github.com/user');
    expect(c).toMatchObject({ provider: "github", headers: ["accept", "authorization"], authScheme: "apikey", optionsOpaque: false });
    expect((await one('curl "${OPTS[@]}" https://api.example.org/a')).optionsOpaque).toBe(true);
  });

  it("drops runners in front of the program", async () => {
    expect((await calls("sudo -u app curl https://a.example.org/x; timeout 30 wget https://b.example.org/y; env A=1 command curl https://c.example.org/z")).map((c) => c.host)).toEqual([
      "a.example.org",
      "b.example.org",
      "c.example.org",
    ]);
  });
});

describe("shell: wrapper functions", () => {
  const api = 'api() {\n  curl -sS -H "Authorization: Bearer $TOKEN" "https://api.example.org/$1" "${@:2}"\n}\n';

  it("reports a function sending a request built from its arguments at each call, with the arguments read there", async () => {
    const all = await calls(`${api}api users\napi orders -X POST -d '{"sku": "a1"}'`);
    expect(all.map((c) => [c.location.line, c.method, c.pathTemplate, c.via ?? "", c.optionsOpaque])).toEqual([
      [2, "GET", "/{arg1}", "", true],
      [4, "GET", "/users", "wrapper:api", false],
      [5, "POST", "/orders", "wrapper:api", false],
    ]);
    expect(await calls(`${api}api users`, false)).toHaveLength(1);
  });

  it("takes only the branch a call's arguments select", async () => {
    const fn = 'req() {\n  case "$1" in\n    get) curl "$2";;\n    post) curl -d "$3" "$2";;\n  esac\n  if [ "$1" = head ]; then curl -I "$2"; fi\n}\nreq post https://api.example.org/a x=1\n';
    const all = (await calls(fn)).filter((c) => c.via);
    expect(all.map((c) => [c.method, c.urlTemplate])).toEqual([["POST", "https://api.example.org/a"]]);
  });

  it("does not repeat a request that does not read the function's arguments", async () => {
    const all = await calls('ping() {\n  echo "$1"\n  curl https://api.example.org/ping\n}\nping a\nping b');
    expect(all.map((c) => c.location.line)).toEqual([3]);
  });

  it("leaves a function named like a client to its calls (`curl() { command curl ... }`)", async () => {
    const all = await calls('curl() {\n  command curl --retry 3 "$@"\n}\ncurl https://api.example.org/a');
    expect(all.map((c) => [c.location.line, c.urlTemplate, c.via ?? ""])).toEqual([[4, "https://api.example.org/a", "wrapper:curl"]]);
  });
});

describe("shell: wget and HTTPie", () => {
  it("reads wget's method, data, headers and output options", async () => {
    const c = await one('wget -qO- --method=PUT --body-data \'{"a": 1}\' --header "Content-Type: application/json" https://api.example.org/a');
    expect(c).toMatchObject({ client: "wget", method: "PUT", bodyEncoding: "json", headers: ["content-type"] });
    expect((await one("wget -nv --post-file=data.json https://api.example.org/a")).method).toBe("POST");
  });

  it("reads HTTPie's method, items and flags", async () => {
    const c = await one('http --auth-type=bearer -a "$T" PUT api.example.org/items/1 name=widget price:=9.5 X-Request-Id:abc page==2');
    expect(c).toMatchObject({ client: "httpie", method: "PUT", urlTemplate: "http://api.example.org/items/1", query: ["page"], authScheme: "bearer", headers: ["x-request-id"], bodyEncoding: "json" });
    expect(props(c)).toEqual({ name: { type: "string", enum: ["widget"] }, price: { type: "number", enum: [9.5] } });
    expect((await one("https api.example.org/up")).urlTemplate).toBe("https://api.example.org/up");
    expect((await one("http -f POST :8080/login user=ada")).bodyEncoding).toBe("form");
  });
});
