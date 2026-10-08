# apicalls

[![CI](https://github.com/okapi-hq/api-grep/actions/workflows/ci.yml/badge.svg)](https://github.com/okapi-hq/api-grep/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**Find every outbound HTTP and SDK call in a TypeScript codebase, without running it.**

Point `apicalls` at a repository and it lists every call the code makes to an external API:
provider, method, path template, the *shape* of the payload (names and types, never values),
headers, auth scheme, and a `dynamic` list of what could not be known statically. It reads the
code through the TypeScript type checker. No AI, no network, no runtime.

Use it to:

- inventory the third-party APIs a codebase depends on;
- review the outbound calls a pull request adds (`--changed-since origin/main`);
- check request payloads against OpenAPI specs (`--specs`, `--validate`);
- get a runnable `curl` command for every call (`--curl`).

## Quick start

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/okapi-hq/api-grep.git
cd api-grep
pnpm install
pnpm build
node dist/cli.js scan path/to/your-repo
```

`pnpm dev scan <dir>` runs the CLI from source without building.

## Example

Given this code:

```ts
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCustomer(email: string, userId: string) {
  return stripe.customers.create({ email, name: "Ada", metadata: { userId } });
}

export const getIntent = (id: string) => stripe.paymentIntents.retrieve(id);
```

`apicalls scan` prints:

```
┌──────┬──────────────┬────────┬────────────────────────────────────────┬────────────────────────────────────┬─────┬────────────────────────────────────────┐
│ conf │ provider     │ method │ path                                   │ body                               │ dyn │ location                               │
├──────┼──────────────┼────────┼────────────────────────────────────────┼────────────────────────────────────┼─────┼────────────────────────────────────────┤
│ 1.00 │ stripe sdk   │ POST   │ /v1/customers                          │ {email, name, metadata}            │ 2   │ stripe-literal.ts:6                    │
├──────┼──────────────┼────────┼────────────────────────────────────────┼────────────────────────────────────┼─────┼────────────────────────────────────────┤
│ 1.00 │ stripe sdk   │ GET    │ /v1/payment_intents/{intent}           │ -                                  │ 1   │ stripe-literal.ts:9                    │
└──────┴──────────────┴────────┴────────────────────────────────────────┴────────────────────────────────────┴─────┴────────────────────────────────────────┘
```

With `--curl`, each call becomes concrete example requests. Credentials are never invented:

```sh
# literal.ts:4  stripe POST /v1/customers  (confidence 0.60)
# minimal
curl -X POST 'https://api.stripe.com/v1/customers' \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'email=greta.moreau@example.com' \
  --data-urlencode 'name=Ada Lovelace' \
  --data-urlencode 'metadata[plan]=pro'
```

With `--json`, you get the full report: one object per call with its location, provider, host,
method, URL template, query keys, headers, auth scheme, body shape, dynamic parts, confidence,
spec findings and examples. The schema is in [`src/report/schema.ts`](src/report/schema.ts).

## Usage

```sh
apicalls scan <dir>                                   # table
apicalls scan <dir> --curl                            # one curl command per example request
apicalls scan <dir> --json                            # JSON report on stdout
apicalls scan <dir> --out report.json --changed-since origin/main
apicalls scan <dir> --specs ./specs --validate
```

| option | description |
|---|---|
| `--json` | print the JSON report on stdout instead of the table |
| `--curl` | print example requests as curl commands |
| `--examples <n>` | maximum example requests per call (default 3, `0` disables) |
| `--out <file>` | write the JSON report to a file |
| `--tsconfig <path>` | tsconfig.json to load (default: nearest) |
| `--changed-since <ref>` | only scan files changed since a git ref, plus their direct importers |
| `--specs <dir>` | directory of `<provider>.{json,yaml}` OpenAPI specs, or an [APIs-guru](https://github.com/APIs-guru/openapi-directory) checkout |
| `--validate` | check request shapes against the specs (requires `--specs`) |
| `--min-confidence <n>` | hide calls below this confidence in the table (default 0.3; JSON keeps everything) |
| `--include <glob>` / `--exclude <glob>` | filter scanned files (repeatable) |
| `--no-wrappers` | disable one-hop wrapper expansion |

Large monorepos need several GB of heap. The CLI re-runs itself with
`--max-old-space-size=8192`; set `APICALLS_HEAP_MB` to change it, or to `0` to opt out.

The package also exports the scanner as a library (`scan`, `toJson`, `ReportSchema`, …) from
[`src/index.ts`](src/index.ts).

## What it detects

| client | patterns |
|---|---|
| fetch | global `fetch`, `node-fetch`, `undici.fetch`, `cross-fetch`, `fetch(new Request(...))` |
| axios | `axios.<verb>()`, `axios(cfg)`, `axios.request(cfg)`, instances from `axios.create({ baseURL })`, aliased and `require`d imports |
| got / ky | `got(url, opts)`, `got.<verb>()`, `got.extend({ prefixUrl })`, `ky.create({ prefixUrl })`, `json` / `form` / `body` / `searchParams` |
| node http | `https.request(opts)`, `https.get(url)` |
| SDKs | registry-driven: `stripe`, `openai`, `@octokit/rest`, `@slack/web-api`, `twilio`, `@aws-sdk/client-s3`, `aws-sdk` v2, `@supabase/supabase-js` (and `@supabase/ssr`), `firebase` modular (Firestore, Auth, Storage), `@sentry/*` |
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

## How it works

The pipeline is `detect → resolve → normalize → validate → score → emit`.

- **URL**: string and template literals, `+` concatenation, `new URL(path, base)`, same-file
  and imported constants, `as const` config objects, enums and `process.env.X` (with hints
  from `.env.example`). Unresolvable segments become `{name}` placeholders and are listed under
  `dynamic` with their origin (`param`, `call`, `env`, `unknown`).
- **Body**: object literals first (literal values become `enum`), spreads merged, computed keys
  flagged; anything else goes through the checker's declared type. `JSON.stringify`,
  `URLSearchParams`, `FormData`, `qs.stringify` and form-encoded template strings are
  unwrapped. `any` degrades to `dynamic`.
- **Headers**: names only. Literal values are kept unless they look like credentials, and the
  auth scheme is inferred (`Bearer `, `Basic `, `x-api-key`).
- **Wrappers** (one hop): a local function or method whose body performs an HTTP call *and*
  whose parameters flow into it is treated as a client. Calls to it are reported at the call
  site with `via: "wrapper:<name>"` and the caller's arguments substituted, including
  `fn.call(this, …)` and destructured `options`.
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
denylist (`sk_live_`, `AKIA`, `ghp_`, JWTs, long hex) and secret-looking values are replaced
with `<redacted>` and counted in `stats.redacted`.

### Robustness

The report is validated one call at a time: a call that does not fit the schema is dropped with
a warning on stderr and the rest of the report is still written. A file that cannot be read (a
syntax error, an import whose module specifier is not a string literal) or that makes a
detector throw is skipped with a warning. One file or one call never stops the scan.

## Limitations

- A conditional between two static URLs (`prod ? A : B`) resolves to the first branch.
- Wrapper expansion stops at one hop; the definition-site call is still reported.
- SDK detection only covers the packages in [`src/detect/registry`](src/detect/registry).
- Twilio and Octokit path parameters that come from the client instance stay as placeholders.
- Spec matching treats id-looking literal segments as parameters.

## Evaluation

The scanner is measured on 20 open-source TypeScript repositories listed in
[`eval/repos.json`](eval/repos.json). Results are in [`eval/results.md`](eval/results.md).

```sh
pnpm eval                       # shallow-clone, scan, write eval/out/<repo>.json and a summary
pnpm eval dub                   # a single repository
pnpm eval:score sample dub 100  # stratified sample to label by hand
pnpm eval:score                 # precision per field and confidence bucket, recall when available
```

The labeling protocol is in [`eval/label/README.md`](eval/label/README.md).

## Contributing

Contributions are welcome, especially new SDK registries. See [CONTRIBUTING.md](CONTRIBUTING.md)
for the development setup and guidelines. This project follows the
[Contributor Covenant](CODE_OF_CONDUCT.md).

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
