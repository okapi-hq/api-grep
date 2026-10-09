# api-grep

[![CI](https://github.com/okapi-hq/api-grep/actions/workflows/ci.yml/badge.svg)](https://github.com/okapi-hq/api-grep/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**Find every outbound HTTP and SDK call in a TypeScript, JavaScript, Python, PHP or HTML codebase, without running it.**

Point `api-grep` at a repository and it lists every call the code makes to an external API:
provider, method, path template, the *shape* of the payload (names and types, never values),
headers, auth scheme, and a `dynamic` list of what could not be known statically. It reads
TypeScript, JavaScript and the inline scripts and forms of HTML pages through the TypeScript type
checker, and Python and PHP through tree-sitter; a repository that mixes languages gets one report
that says which language each call comes from. No AI, no network, no runtime. How each language is
read: [docs/languages.md](docs/languages.md).

Use it to:

- inventory the third-party APIs a codebase depends on;
- review the outbound calls a pull request adds (`--changed-since origin/main`);
- check request payloads against OpenAPI specs (`--specs`, `--validate`);
- get a runnable `curl` command for every call (`--curl`);
- run it as a service: `api-grep serve` scans the archives sent to it ([HTTP server](#http-server), [Docker](#docker)).

## Quick start

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/okapi-hq/api-grep.git
cd api-grep
pnpm install
pnpm build
node dist/cli.js scan path/to/your-repo
```

`pnpm dev scan <dir>` runs the CLI from source without building. With Docker, no install is needed:

```sh
docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo
```

## Example

Given this code in `billing/stripe.ts`:

```ts
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCustomer(email: string, userId: string) {
  return stripe.customers.create({ email, name: "Ada", metadata: { userId } });
}

export const getIntent = (id: string) => stripe.paymentIntents.retrieve(id);
```

`api-grep scan` prints one section per file, with its language, then one row per call:

```
┌──────┬────────┬──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┬──────┐
│ line │ method │ provider         │ path                                     │ body                               │ dyn │ conf │
├──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┴──────┤
│ billing/stripe.ts  typescript                                                                                                 │
├──────┬────────┬──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┬──────┤
│ 6    │ POST   │ stripe sdk       │ /v1/customers                            │ {email, name, metadata}            │ 2   │ 1.00 │
├──────┼────────┼──────────────────┼──────────────────────────────────────────┼────────────────────────────────────┼─────┼──────┤
│ 9    │ GET    │ stripe sdk       │ /v1/payment_intents/{intent}             │ -                                  │ 1   │ 1.00 │
└──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┴──────┘
2 calls in 1 file (2 shown at confidence >= 0.3); languages: typescript=2; providers: stripe=2
scanned 1/1 files, complete
```

`dyn` counts the parts that could not be known statically; `conf` is the [confidence](#confidence).

The same calls in Python (and PHP: `\Stripe\Customer::create([...])`, `$stripe->customers->create([...])`)
are reported the same way:

```python
import os
import stripe

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]

def create_customer(email: str, user_id: str):
    return stripe.Customer.create(email=email, name="Ada", metadata={"userId": user_id})
```

```
├──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┴──────┤
│ billing.py  python                                                                                                            │
├──────┬────────┬──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┬──────┤
│ 7    │ POST   │ stripe sdk       │ /v1/customers                            │ {email, name, metadata}            │ 2   │ 1.00 │
└──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┴──────┘
```

With `--curl`, each call becomes concrete example requests. Credentials are never invented:

```sh
# billing/stripe.ts:6 (typescript)  stripe POST /v1/customers  (confidence 1.00)
# minimal
curl -X POST 'https://api.stripe.com/v1/customers' \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=maya.ekwall@example.com' \
  --data-urlencode 'name=Ada' \
  --data-urlencode 'metadata={"userId":"dw8ydaub"}'
```

## Output format

`api-grep scan <dir> --json` (or `--out report.json`) writes one JSON document. For the example
above, with `--examples 1`, shown as YAML with one comment per field and the second call left out:

```yaml
$schema: https://raw.githubusercontent.com/okapi-hq/api-grep/main/schema/report.v1.json
schemaVersion: 1.3.0            # report format version; readers check the major
tool: api-grep
version: 0.1.0                  # tool version
repo: shop                      # name of the scanned directory
commit: 9ae2b37…                # HEAD, when the directory is a git repository
calls:                          # one entry per call, sorted by file, line, column
  - id: 916d2bd1f6b1            # stable: hash of file, line and column
    location:
      file: billing/stripe.ts   # relative to the scanned directory
      line: 6
      col: 10
      language: typescript      # typescript | javascript | html | python | php
    client: sdk                 # fetch | axios | got | ky | node-http | jquery | xhr (TypeScript, JavaScript), html-form (HTML), requests | httpx | aiohttp | urllib | urllib3 (Python), guzzle | laravel-http | symfony-http | curl | psr-18 | php-stream | wordpress (PHP), sdk | framework
    sdk: { package: stripe, version: ^22.6.1, chain: customers.create }
    provider: stripe            # `api-grep providers` id, or internal | env:<NAME> | unknown
    providerSource: sdk         # sdk | host | env-name
    host: api.stripe.com        # may hold placeholders: {project}.supabase.co
    hostKind: literal           # literal | const | env | relative | unknown
    scheme: https
    method: POST                # DYNAMIC when not known statically
    pathTemplate: /v1/customers # {name} marks a dynamic segment
    urlTemplate: https://api.stripe.com/v1/customers
    operationId: PostCustomers  # from the SDK registry or a matched OpenAPI spec
    query: []                   # query parameter names
    headers: []                 # header names
    headerValues: {}            # literal values only; null for credentials
    authScheme: bearer          # bearer | apikey | basic | none | unknown
    body:                       # shape: names and types, never data
      type: object
      properties:
        email: { type: string, hint: email }
        name: { type: string, enum: [Ada] }   # literal value from the code
        metadata: { type: object, properties: { userId: { type: string, hint: userId } }, required: [userId] }
      required: [email, name, metadata]
    bodyEncoding: form          # json | form | multipart | raw | none
    dynamic:                    # what could not be known statically
      - { where: body, name: email, origin: param }
      - { where: body, name: userId, origin: param }
    confidence: 1               # 0 to 1
    findings: []                # spec mismatches, with --specs --validate
    examples:                   # concrete requests with invented values
      - variant: minimal        # minimal | full | alt
        method: POST
        url: https://api.stripe.com/v1/customers
        headers: { authorization: Bearer <token>, content-type: application/x-www-form-urlencoded }
        query: {}
        body: { email: maya.ekwall@example.com, name: Ada, metadata: { userId: dw8ydaub } }
        bodyEncoding: form
stats:                          # counts over calls
  filesScanned: 1
  callsFound: 2
  byLanguage: { typescript: 2 }
  byClient: { sdk: 2 }
  byProvider: { stripe: 2 }
  byHostKind: { literal: 2 }
  withBodyShape: 1
  withDynamic: 2
  withFindings: 0
  redacted: 0                   # secret-looking strings replaced with <redacted>
  durationMs: 1044
diagnostics:                    # what the scan could not read, see Diagnostics
  filesSeen: 1
  filesScanned: 1
  skipped: []
  skippedCounts: {}
  droppedCalls: []
  unfollowed: []
  languages: { typescript: { filesSeen: 1, filesScanned: 1 } }   # files per language
  complete: true                # false: partial scan, exit code 2
coverage:                       # API SDKs the repo uses, see SDK coverage
  sdks:
    - { package: stripe, ecosystem: npm, provider: stripe, supported: true, declared: true, imported: true, importSites: 1, calls: 2, status: ok }
```

### Contract

The format is specified by a JSON Schema (draft-07), [`schema/report.v1.json`](schema/report.v1.json),
which describes every field. It is generated from [`src/report/schema.ts`](src/report/schema.ts)
and a test fails when it is out of date, so it always matches what the CLI writes. Get it from
this repository, from `api-grep schema`, or in Node from `import schema from "api-grep/schema.json"`,
and validate reports with any JSON Schema validator (ajv, Python `jsonschema`, …).

`schemaVersion` is the version of the format, separate from the tool's `version`:

- **minor** (`1.1.0`): new fields or enum values, such as a new `client` or `language`. Readers
  ignore fields they do not know and treat unknown enum values as "other". Objects in the schema
  stay open, so a 1.0 reader still validates a 1.1 report.
- **major** (`2.0.0`): anything that can break a reader. The schema moves to `report.v2.json` and
  `report.v1.json` stays.

Each call names its file and language in `location`, `stats.byLanguage` counts calls per language
and `diagnostics.languages` files per language: `typescript`, `javascript`, `html` (inline scripts
and forms, at their line in the page), `python` and `php` share one format. Coverage rows name their
package `ecosystem` (`npm`, `pypi`, `composer`).

## Usage

```sh
api-grep scan <dir>                                   # table
api-grep scan <dir> --curl                            # one curl command per example request
api-grep scan <dir> --json                            # JSON report on stdout
api-grep scan <dir> --out report.json --changed-since origin/main
api-grep scan <dir> --specs ./specs --validate
api-grep schema                                       # JSON Schema of the --json report
api-grep providers                                    # provider ids, names, hosts and packages
api-grep scan <dir> --language python                 # one language only
api-grep serve --port 8080                            # HTTP server, see below
```

| option | description |
|---|---|
| `--language <ids>` | languages to scan, comma-separated or repeated: `typescript`, `javascript`, `html`, `python`, `php` (default: every language with files in scope) |
| `--json` | print the JSON report on stdout instead of the table |
| `--curl` | print example requests as curl commands |
| `--examples <n>` | maximum example requests per call (default 3, `0` disables) |
| `--out <file>` | write the JSON report to a file |
| `--tsconfig <path>` | TypeScript: tsconfig.json to load (default: nearest) |
| `--changed-since <ref>` | only scan files changed since a git ref, plus their direct importers |
| `--specs <dir>` | directory of `<provider>.{json,yaml}` OpenAPI specs, or an [APIs-guru](https://github.com/APIs-guru/openapi-directory) checkout |
| `--validate` | check request shapes against the specs (requires `--specs`) |
| `--min-confidence <n>` | hide calls below this confidence (0 to 1) in the table and `--curl` output (default 0.3; JSON keeps everything) |
| `--include <glob>` / `--exclude <glob>` | filter scanned files (repeatable); excluded files are still read to resolve imports |
| `--no-wrappers` | disable wrapper expansion |

Large monorepos need several GB of heap. The CLI re-runs itself with
`--max-old-space-size=8192`; set `API_GREP_HEAP_MB` to change it, or to `0` to opt out.

**Exit codes:** `0` complete scan, `2` partial scan (the report is still written, see
[diagnostics](#diagnostics)), `1` fatal error (for example the directory does not exist).

The package also exports the scanner as a library (`scan`, `finalizeReport`, `toJson`, `toTable`, `toCurl`,
`ReportSchema`, `reportJsonSchema`, …). `scan` returns the raw report: pass it through `finalizeReport` (redaction,
validation) before `toTable` or `toCurl`. See
[`src/index.ts`](src/index.ts).

## HTTP server

`api-grep serve` scans the archives it receives: POST a gzip-compressed tar of a repository, get the JSON report
back. It is the same scan as the command line, run in a child process for each request.

```sh
export API_GREP_TOKEN=$(openssl rand -hex 32)
api-grep serve --host 0.0.0.0 --port 8080
git archive --format=tar.gz --prefix=repo/ HEAD \
  | curl --data-binary @- -H "authorization: Bearer $API_GREP_TOKEN" -H "content-type: application/gzip" \
    "http://localhost:8080/v1/scan?examples=1"
```

| route | answer |
|---|---|
| `POST /v1/scan` | the report (`200`, a partial scan included) for the archive in the body. Query: `language` (as `--language`), `examples` (0 to 20). A `Server-Timing` header gives the unpack and scan times |
| `GET /v1/providers` | the provider table, as `api-grep providers` prints it |
| `GET /v1/health` | `status`, `version`, `schemaVersion` and whether a scan is running. The only route without the token |

Errors are JSON, `{ "error": { "code", "message" } }`: `400` bad query, `401` missing or wrong token, `413` archive
over a limit, `415` not `application/gzip`, `422` not a readable archive or an unsafe entry, `429` a scan is already
running (one at a time; `Retry-After` is set), `500` the scan failed, `504` the scan timed out.

An archive with a single top-level directory (`git archive --prefix`, a GitHub tarball) is scanned from that
directory. The archive is untrusted: only regular files and directories are unpacked (no link, device or `.git`),
an absolute or `..` path or a corrupt archive fails the request, and nothing of it stays on disk after the answer.
The scan process gets none of the server's environment variables.

| variable | default | |
|---|---|---|
| `API_GREP_TOKEN` | none | bearer token of every route but health; required to listen beyond loopback, at least 16 characters |
| `API_GREP_HOST`, `API_GREP_PORT` | `127.0.0.1`, `8080` (or `PORT`) | address and port; `--host` and `--port` win |
| `API_GREP_MAX_ARCHIVE_MB` | 512 | largest request body |
| `API_GREP_MAX_UNPACKED_MB`, `API_GREP_MAX_FILES` | 2048, 200000 | largest unpacked size and entry count of one archive |
| `API_GREP_SCAN_TIMEOUT_S` | 900 | the scan process is killed after it |
| `API_GREP_MAX_REPORT_MB` | 256 | largest report |
| `API_GREP_HEAP_MB` | 8192 | heap of each scan process; keep it below the memory the server has |

Logs give the route, status and duration of each request, never a path or a value from an archive.

## Docker

The image runs `api-grep serve` on port 8080 by default, and any other command when given one:

```sh
docker run --rm -p 8080:8080 -e API_GREP_TOKEN=<16+ characters> ghcr.io/okapi-hq/api-grep
docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo --json
```

Tags: `main` follows the main branch, `X.Y.Z` and `X.Y` are releases. The version an image reports is
`<version>+<commit>` (`0.2.0+f71db3312345`), so every report names the exact code that wrote it; the same comes from
`API_GREP_BUILD` outside Docker. `docker build --build-arg API_GREP_COMMIT=$(git rev-parse --short=12 HEAD) .`
builds it locally.

## What it detects

Which SDKs have a registry in which language: [docs/sdk-support.md](docs/sdk-support.md).

### TypeScript and JavaScript

JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`) is read by the same type checker as TypeScript, so
everything below applies to both, with CommonJS (`require`, `module.exports`, `require("stripe")(key)`)
and `jsconfig.json` path aliases. Minified, bundled and vendored files are build output and are
not scanned.

| client | patterns |
|---|---|
| fetch | global `fetch`, `node-fetch`, `undici.fetch`, `cross-fetch`, `fetch(new Request(...))` |
| axios | `axios.<verb>()`, `axios(cfg)`, `axios.request(cfg)`, instances from `axios.create({ baseURL })`, aliased and `require`d imports |
| got / ky | `got(url, opts)`, `got.<verb>()`, `got.extend({ prefixUrl })`, `ky.create({ prefixUrl })`, `json` / `form` / `body` / `searchParams` |
| node http | `https.request(opts)`, `https.get(url)` |
| SDKs | registry-driven: `stripe`, `openai` (also pointed elsewhere by `baseURL`), `@anthropic-ai/sdk`, `@google/genai`, `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime`, `@octokit/rest`, `@slack/web-api`, `twilio`, `resend`, `@lemonsqueezy/lemonsqueezy.js`, RevenueCat (`react-native-purchases`, `@revenuecat/purchases-js`), `posthog-js`, `posthog-node`, `convex`, `@modelcontextprotocol/sdk`, `@aws-sdk/client-s3`, `aws-sdk` v2, `@supabase/supabase-js` (and `@supabase/ssr`), `firebase` modular (Firestore, Auth, Storage), `@sentry/*` |
| AI SDK | `generateText` / `streamText` / `generateObject` / `streamObject` / `embed` / ... from `ai`: the provider, host and path come from the model (`openai("gpt-4o")`, `anthropic(...)`, `google(...)`, `vertex(...)`, `openrouter(...)`, `createOpenAI({ baseURL })(...)`, a `"provider/model"` string for the AI Gateway); a model the scan cannot trace is still a call, with provider `unknown` |
| jQuery | `$.ajax({ url, type, data, contentType, headers })`, `$.ajax(url, settings)`, `$.get` / `$.getJSON(url, data)` (data as query), `$.post(url, data)` (form body, JSON with `contentType`) |
| XMLHttpRequest | `xhr.open(method, url)`, `setRequestHeader(...)`, reported at `xhr.send(body)` |
| frameworks | options-object helpers: n8n `this.helpers.httpRequest` / `request` / `*WithAuthentication.call(this, cred, options)`, activepieces `httpClient.sendRequest`, ai-sdk `postJsonToApi` / `postToApi` / `postFormDataToApi` / `getFromApi` |

Callees are identified by declaration through the type checker, never by name: a shadowed
`fetch` is ignored and `import http from "axios"` is still axios. SDK instances are followed
through `new Stripe()`, exported instances in other files, class properties (`this.stripe`),
local factories and typed parameters (`stripe: Stripe`, `ctx.db` with `db: SupabaseClient`);
without the package's types installed, the written annotation is traced to its import.

Builder SDKs report one call per request: `supabase.from("tasks").select().eq("id", id).single()`
is a `GET /rest/v1/tasks` at the start of the chain (filters and `.single()` are not extra calls),
with the host taken from the URL given to `createClient`. Firebase paths are read from the
reference (`getDoc(doc(db, "users", uid))` is `.../documents/users/{uid}`); `signOut` and
`Sentry.init` send nothing and are not reported.

A client constructed with its own base URL (`new OpenAI({ baseURL: "https://openrouter.ai/api/v1" })`,
`new PostHog(key, { host })`, `new ConvexHttpClient(url)`) sends its calls there, and the provider
follows the URL when it names another known service (OpenRouter, Groq, `localhost:11434` for
Ollama). MCP clients get the server URL from the HTTP transport built in the same file.

Libraries loaded with a `<script>` tag are used as globals the checker cannot see: `axios`, `$` /
`jQuery`, `supabase`, `Sentry` and `posthog` are read as their npm packages. Imports from a CDN
(`https://esm.sh/stripe`, `https://cdn.jsdelivr.net/npm/...`) and Deno `npm:` specifiers name their
package too.

### HTML

| source | what is reported |
|---|---|
| inline `<script>` | everything in the TypeScript / JavaScript table, at its line and column in the page; JSON, templates and import maps are skipped, old `<!-- //-->` wrappers are read |
| `<form action>` | a request to the action URL with its method; the named fields are the body (`multipart` / `form` from `enctype`) or, for a GET, the query; `email` / `number` / `hidden` fields are typed |
| `<script src>` from a CDN | an import of the npm package, for the SDK coverage |

Server-side template tags in scripts (Jinja / Django `{{ x }}`, `{% url %}`, EJS `<%= %>`, PHP
`<?= ?>`) are read as dynamic values: `fetch("{{ api_url }}/items")` is `{api_url}/items`. Forms
whose action is a template, an anchor or a `mailto:` are not requests.

### Python

| client | patterns |
|---|---|
| requests | `requests.get/post/...(url, json=, data=, files=, params=, headers=, auth=)`, `requests.request(method, url)`, `Session()` objects (also `with requests.Session() as s`) |
| httpx | module functions, `request`, `stream`, `Client` / `AsyncClient` with `base_url` and `headers`, also through `async with` |
| aiohttp | `ClientSession(base_url)` and its verbs, `request(method, url)` |
| urllib | `urllib.request.urlopen(url, data)`, `urlopen(Request(url, data, headers, method=...))` (POST when there is data), `urllib3.PoolManager().request(...)` |
| SDKs | registry-driven, see [docs/sdk-support.md](docs/sdk-support.md): OpenAI (also Azure, and other services through `base_url`), Anthropic (also Bedrock and Vertex clients), Google Gen AI, Google Generative AI, Stripe (`StripeClient` and the classic `stripe.Customer.create`), Supabase, Firebase Admin, Firestore, Sentry, boto3 (S3, Bedrock runtime), Twilio, Slack, Resend, PostHog, Mistral, Groq, Cohere, ElevenLabs, Convex |

Python keyword arguments are SDK bodies (`client.chat.completions.create(model=..., messages=...)`).
Clients are followed through module variables and imports, `self.client = OpenAI()` in any method,
annotated parameters and locals (`client: OpenAI`, `db: Client = ctx.db`), factories that return a
client, `x or OpenAI()` defaults and subclasses of a client class. The builder and base URL rules
above apply too: `supabase.table("tasks").select("*").eq(...).execute()` is one `GET /rest/v1/tasks`,
`OpenAI(base_url="https://openrouter.ai/api/v1")` sends to OpenRouter. How the Python front end
works, and how to add a language: [docs/languages.md](docs/languages.md).

### PHP

| client | patterns |
|---|---|
| Guzzle | `new Client(['base_uri' => ..., 'headers' => ...])`, verbs and `*Async`, `request($method, $uri, $options)`, options `json`, `form_params`, `multipart`, `body`, `query`, `headers`, `auth`; also `ClientInterface` parameters and `\Drupal::httpClient()` |
| Laravel `Http` | `Http::post($url, $data)` / `get($url, $query)` / `send(...)` with fluent `withToken`, `withBasicAuth`, `withHeaders`, `asForm`, `asMultipart`, `baseUrl`, `withQueryParameters`, `withOptions`; `config('services.x.url')` is read from `config/services.php` |
| Symfony HttpClient | `HttpClient::create([...])`, `createForBaseUri($url)`, `HttpClientInterface` injection, `request($method, $url, ['json' => ..., 'query' => ..., 'auth_bearer' => ...])` |
| curl | `curl_init($url)` + `curl_setopt` / `curl_setopt_array` (`CURLOPT_URL`, `CUSTOMREQUEST`, `POST`, `POSTFIELDS`, `HTTPHEADER`, `USERPWD`), reported at `curl_exec` |
| PSR-7 / PSR-18 | `$client->send(new Request(...))`, `sendRequest(...)`, also through a helper that builds the request |
| streams | `file_get_contents` / `fopen` on an `http(s)` URL or with a `stream_context_create(['http' => ...])` context (file reads are not calls) |
| WordPress | `wp_remote_get`, `wp_remote_post`, `wp_remote_request` (and `wp_safe_*`) |
| SDKs | registry-driven, see [docs/sdk-support.md](docs/sdk-support.md): Stripe (`StripeClient`, static `\Stripe\Customer::create`), openai-php (client, factory with `withBaseUri`, Laravel facade), Anthropic (official, named arguments; mozex), Gemini, AWS (S3, Bedrock runtime), Twilio, Firebase (kreait, Firestore), Sentry, Resend, PostHog, SendGrid, Mailgun, Slack |

Names resolve through namespaces and `use` (classes, functions, constants), `self::` / `static::`,
class constants, `define()` / `const`, promoted and typed properties, `$this->x` set in any
method, closures with `use (...)`, `env('X', 'default')`, `getenv()`, `$_ENV` and `$_SERVER`.

## How it works

The pipeline is `detect → resolve → normalize → validate → score → emit`. Detection and resolution
are per language (TypeScript, JavaScript and HTML scripts through the type checker, Python and PHP
through tree-sitter and a shared engine, see [docs/languages.md](docs/languages.md)); everything
after that is shared, so a call is
described, scored and checked the same way whatever its language. The rules below are given for
TypeScript; Python follows the same ones with its own syntax (f-strings, `%` and `.format()`,
`os.getenv("X", "https://...")`, `os.environ[...]`, dataclass / TypedDict / pydantic bodies).

- **URL**: string and template literals, `+` concatenation, `new URL(path, base)`, same-file
  and imported constants, `as const` config objects, enums, `process.env.X` (with hints
  from `.env.example`), local helpers that return a URL (`apiUrl("sendMessage")`, arguments
  substituted), `this.baseUrl` set in the constructor or as a parameter property default, and
  parameter defaults. Unresolvable segments become `{name}` placeholders and are listed under
  `dynamic` with their origin (`param`, `call`, `env`, `unknown`).
- **Body**: object literals first (literal values become `enum`), spreads merged, computed keys
  flagged; anything else goes through the checker's declared type. `JSON.stringify`,
  `URLSearchParams`, `FormData`, `qs.stringify` and form-encoded template strings are
  unwrapped. `any` degrades to `dynamic`.
- **Provider**: from the SDK registry, else the host through
  [`src/normalize/providers.json`](src/normalize/providers.json) (`id`, `name`, `hosts`,
  `packages`; an exact host wins over the longest matching suffix). An env URL with a literal
  default (`process.env.X ?? "https://api.langdock.com/v1"`) keeps `envName` and takes the
  default's host and base path; with no value at all, the env var's name is used
  (`OPENROUTER_BASE_URL` gives `openrouter`, `providerSource: "env-name"`, lower confidence). A
  host that still holds a placeholder never becomes a provider: it is `internal` (localhost),
  `env:<NAME>` or `unknown`. `internal` (relative URLs, localhost) is the repo's own backend.
  `api-grep providers` prints the table as JSON so other tools can share the same names.
- **Headers**: names only. Literal values are kept unless they look like credentials, and the
  auth scheme is inferred (`Bearer `, `Basic `, `x-api-key`).
- **Wrappers** (two hops): a local function or method whose body performs an HTTP call *and*
  whose parameters flow into its request (URL, method, query, body; for an SDK call, the
  arguments its registry reads) is treated as a client. Calls to it are reported at the call
  site with `via: "wrapper:<name>"` and the caller's arguments substituted, including
  `fn.call(this, …)` and destructured `options`. A function that passes its parameters to such a
  wrapper is one too (`latest()` -> `tlsFetch(url)` -> `doFetch(url)` -> `fetch` is reported at
  `latest()` with `via: "wrapper:tlsFetch>doFetch"`). `reportError(err)` ->
  `Sentry.captureException(err)` is not a client: every caller sends the same request, so only
  the call inside it is reported. A wrapper that sends the same request twice (a retry) gives one
  call per call site; different requests from one call site get distinct `id`s.
- **Specs**: with `--specs`, path templates are matched to OpenAPI operations. `--validate`
  adds deterministic findings: unknown property, missing required, type mismatch, enum
  mismatch, deprecated.

### Example requests

Every call carries `examples`, concrete requests synthesized from what was resolved. Values
follow the checker's types and are chosen by name (`email` gets an address, `createdAt` an ISO
date, `per_page` a small integer), seeded by the call id so they are stable across runs.
`minimal` sends required properties, `full` adds optional ones, `alt` switches enum values,
union branches and booleans. Secret-looking keys and headers (`token`, `api_key`, `password`,
`authorization`, `cookie`) become `<name>` placeholders. Unresolved hosts stay visible as
`https://{baseUrl}/…` or `https://{env:API_URL}/…`.

### Confidence

Additive rules, clamped to `[0, 1]`: SDK registry hit +0.6, literal or resolved-constant host
+0.3, env host with `.env.example` hint +0.15, named dynamic path segments +0.1, body from an
object literal +0.2, from a declared type +0.15, body `any`/unknown −0.2, via wrapper −0.1,
spec match +0.1. Unknown or relative hosts are capped at 0.4.

### Privacy

Reports describe shapes, not data. Before output, every emitted string is checked against a
denylist (`sk_live_`, `AKIA`, `ghp_`, JWTs, long hex, URLs with `user:password@`) and
secret-looking values are replaced with `<redacted>` and counted in `stats.redacted`. Literal
values of credential-named body properties and query parameters (`password`, `client_secret`,
`api_key`, `accessToken`) are dropped, credentials in a URL (`https://user:pass@host`) never
reach `host` or `urlTemplate`, and credential headers keep their name only.

### Scanning untrusted code

A scanned repository is treated as hostile input:

- Its code is parsed, never run. With `--specs`, `$ref`s resolve inside the specs directory
  only; a remote `$ref` is an error, not a download.
- Paths, URLs and values it chooses are printed with control characters escaped, so they cannot
  drive the terminal. `--curl` quotes every value and uses `--data-raw` / `--form-string`, so a
  value such as `@/etc/passwd` is sent as written, never read from disk.
- Symlinks that lead out of the scanned directory are not followed, and `package.json`,
  `.env.example` and `tsconfig.json` are read only when they are small regular files.
- `--changed-since` runs `git` in the scanned directory with `core.fsmonitor` off and without
  external diff or textconv drivers. A `.git` directory that arrived with untrusted files (an
  archive, not a clone) can still configure other filters: use it on checkouts you made.

### Diagnostics

`diagnostics` says what the scan could not read, so a partial report never looks complete:

```json
"diagnostics": {
  "filesSeen": 1840,
  "filesScanned": 1702,
  "skipped": [{ "file": "src/legacy/x.ts", "reason": "parse-error", "detail": "Expected the module specifier to be a string literal." }],
  "skippedCounts": { "parse-error": 1, "excluded": 137 },
  "droppedCalls": [{ "file": "lib/a.ts", "line": 120, "reason": "schema-invalid", "detail": "body.properties.config: Invalid input" }],
  "unfollowed": [
    { "file": "executors/x.ts", "line": 90, "reason": "injected-fetch", "expr": "this.fetchFn" },
    { "file": "executors/y.ts", "line": 31, "reason": "wrapper-depth", "via": "tlsFetch" }
  ],
  "languages": { "typescript": { "filesSeen": 1840, "filesScanned": 1702 } },
  "complete": false
}
```

- `skipped`: `parse-error` (a syntax error, or an import whose module specifier is not a string
  literal) and `internal-error` (a detector threw) files are not scanned. Files left out by
  `--exclude` (`excluded`) or `--include` (`not-included`) are listed too, or only counted above
  200. Test files, mocks, declarations and build output are out of scope and not counted. Every
  source file under the directory is scanned, also outside the tsconfig `include`.
- `droppedCalls`: calls that failed the report schema (`schema-invalid`, with the zod path) or
  made the resolver throw (`internal-error`). The rest of the report is still written.
- `unfollowed`: a fetch function received from outside (`this.fetchFn(url)`, `deps.fetchUpstream(url)`),
  an HTTP client object received without a type that names it (`injected-client`: `self.session.post(url)`),
  and calls to a wrapper three or more hops from its HTTP call (the inner call sites are
  reported, the outer one is not). A fetcher with a known default (`constructor(private fetchFn = fetch)`) or declared as
  `typeof fetch` is reported as a fetch call instead.
- `complete` is false when something was lost that was not asked for: a skipped file (other than
  `--exclude` / `--include`), a dropped call or a call not followed. Calls below `--min-confidence`
  are only hidden from the table, never dropped from the JSON.

The table ends with one line: `scanned 1702/1840 files, 3 skipped, 12 calls not followed`.
Skipped files and dropped calls are also printed to stderr as `warning:` lines.

### SDK coverage

`coverage.sdks` compares the API SDKs a repo uses with the calls found, so "0 Supabase calls"
never reads as "no Supabase". Each known SDK package (the `packages` of `providers.json`, by
ecosystem) that a covered manifest declares or a scanned file imports gets a row. The manifests are
`package.json` (`dependencies`, `peerDependencies`; type-only imports aside) for npm, and
`requirements*.txt`, `requirements/*.txt`, `pyproject.toml` (PEP 621 and Poetry), `Pipfile`,
`setup.cfg` and `setup.py` for PyPI (import names that differ from the package, like
`google-genai` / `google.genai`, are in [`src/lang/python/modules.json`](src/lang/python/modules.json)),
and the `require` of `composer.json` for Composer (namespaces per package in
[`src/lang/php/namespaces.json`](src/lang/php/namespaces.json)):

```json
{ "package": "@notionhq/client", "ecosystem": "npm", "provider": "notion", "supported": false,
  "declared": true, "imported": true, "importSites": 41, "calls": 0, "status": "unsupported" }
```

`ok` (registry and calls), `unsupported` (imported, no registry: its calls are missed),
`imported-no-calls` (registry but no call: a wrapper, or a detection bug), `declared-not-imported`
(probably unused). The table prints one `⚠` line per `unsupported` and `imported-no-calls`
package. `--changed-since` scans have no coverage section.

## Limitations

- A conditional between two static URLs (`prod ? A : B`) resolves to the first branch.
- Wrapper expansion stops at two hops; the definition-site call is still reported and deeper
  call sites are listed in `diagnostics.unfollowed` (`wrapper-depth`).
- One call site that picks its host from a table (``fetch(`${PRESETS[name].baseUrl}/models`)``)
  is one call with an unknown host: the candidate hosts are not listed.
- `data:` / `blob:` URLs (`canvas.toDataURL()`, `URL.createObjectURL()`) and calls forwarded by
  a `window.fetch = ...` override are not requests and are not reported.
- SDK detection only covers the packages with a registry ([docs/sdk-support.md](docs/sdk-support.md)).
- Python has no type checker: a client received as an untyped parameter is listed as
  `injected-client`, and SDK methods passed as callbacks (`retry(stripe.Customer.create, ...)`),
  `getattr` calls and module-level configuration (`openai.base_url = ...`) are not followed. See
  [docs/languages.md](docs/languages.md#python) for the full list.
- PHP has no type checker either: untyped properties and parameters used as clients are listed as
  `injected-client`; Saloon connectors, Laravel `Mail` / `Storage` drivers and AWS command objects
  are not followed ([docs/languages.md](docs/languages.md#php)).
- HTML: scripts of other template formats (`.vue`, `.svelte`, `.ejs`, `.hbs`) and JavaScript in
  event-handler attributes (`onclick="fetch(...)"`) are not read; classic scripts of one page share
  globals, scripts of different pages do not.
- Twilio and Octokit path parameters that come from the client instance stay as placeholders.
- Spec matching treats id-looking literal segments as parameters.

## Evaluation

The TypeScript scanner is measured on 20 open-source TypeScript repositories listed in
[`eval/repos.json`](eval/repos.json). Results are in [`eval/results.md`](eval/results.md).

```sh
pnpm eval                       # shallow-clone, scan, write eval/out/<repo>.json and a summary
pnpm eval dub                   # a single repository
pnpm eval:score sample dub 100  # stratified sample to label by hand
pnpm eval:score                 # precision per field and confidence bucket, recall when available
```

The labeling protocol is in [`eval/label/README.md`](eval/label/README.md). Between evaluations,
`tests/recall.test.ts` checks recall on synthetic regression fixtures in CI (see
[CONTRIBUTING.md](CONTRIBUTING.md#tests)).

## Contributing

Contributions are welcome, especially new SDK registries and languages. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the development setup and guidelines. This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md).

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
