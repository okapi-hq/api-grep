# apicalls

Static extractor of outbound HTTP and SDK calls in TypeScript repositories.
Point it at a repo and it prints every outbound call it can find: provider, method,
path template, the *shape* of the payload (names and types, never values), and a
`dynamic` list of what could not be known statically. No AI, no network, no runtime.

```
pnpm dev scan ../some-repo                  # table
pnpm dev scan ../some-repo --curl           # one curl command per example request
pnpm dev scan ../some-repo --json           # Report JSON on stdout (examples included)
pnpm dev scan ../some-repo --out report.json --changed-since origin/main
pnpm dev scan ../some-repo --specs ./specs --validate
pnpm dev scan ../some-repo --examples 1     # at most one example per call (0 disables)
```

Or after `pnpm build`: `node dist/cli.js scan <dir>`. Big monorepos need several GB of heap; the CLI
re-runs itself with `--max-old-space-size=8192` (override with `APICALLS_HEAP_MB`, `0` opts out).

## What it detects

| client | patterns |
|---|---|
| fetch | global `fetch`, `node-fetch`, `undici.fetch`, `cross-fetch`, `fetch(new Request(...))` |
| axios | `axios.<verb>()`, `axios(cfg)`, `axios.request(cfg)`, instances from `axios.create({ baseURL })`, aliased and `require`d imports |
| got / ky | `got(url, opts)`, `got.<verb>()`, `got.extend({ prefixUrl })`, `ky.create({ prefixUrl })`, `json` / `form` / `body` / `searchParams` |
| node http | `https.request(opts)`, `https.get(url)` |
| sdk | registry-driven: `stripe`, `openai` (also pointed elsewhere by `baseURL`), `@anthropic-ai/sdk`, `@google/genai`, `@google/generative-ai`, `@aws-sdk/client-bedrock-runtime`, `@octokit/rest`, `@slack/web-api`, `twilio`, `resend`, `@lemonsqueezy/lemonsqueezy.js`, RevenueCat (`react-native-purchases`, `@revenuecat/purchases-js`), `posthog-js`, `posthog-node`, `convex`, `@modelcontextprotocol/sdk`, `@aws-sdk/client-s3`, `aws-sdk` v2, `@supabase/supabase-js` (and `@supabase/ssr`), `firebase` modular (Firestore, Auth, Storage), `@sentry/*` |
| ai sdk | `generateText` / `streamText` / `generateObject` / `streamObject` / `embed` / ... from `ai`: the provider, host and path come from the model (`openai("gpt-4o")`, `anthropic(...)`, `google(...)`, `vertex(...)`, `openrouter(...)`, `createOpenAI({ baseURL })(...)`, a `"provider/model"` string for the AI Gateway); a model the scan cannot trace is still a call, with provider `unknown` |
| framework | options-object helpers from `src/detect/registry/frameworks.json`: n8n `this.helpers.httpRequest` / `request` / `*WithAuthentication.call(this, cred, options)`, activepieces `httpClient.sendRequest`, ai-sdk `postJsonToApi` / `postToApi` / `postFormDataToApi` / `getFromApi` |

Callees are identified by declaration through the type checker, never by name, so a
shadowed `fetch` is ignored and `import http from "axios"` is still axios. SDK instances
are followed through `const stripe = new Stripe()`, exported instances in other files,
class properties (`this.stripe`), local factories, and typed parameters (`stripe: Stripe`,
`ctx.db` with `db: SupabaseClient`); without the package's types installed, the written
annotation is traced to its import.

Builder SDKs report one call per request: `supabase.from("tasks").select().eq("id", id).single()`
is a `GET /rest/v1/tasks` at the start of the chain (filters and `.single()` are not extra calls),
with the host taken from the URL given to `createClient`. Firebase paths are read from the
reference (`getDoc(doc(db, "users", uid))` is `.../documents/users/{uid}`); `signOut` and
`Sentry.init` send nothing and are not reported.

A client constructed with its own base URL (`new OpenAI({ baseURL: "https://openrouter.ai/api/v1" })`,
`new PostHog(key, { host })`, `new ConvexHttpClient(url)`) sends its calls there, and the provider
follows the URL when it names another known service (OpenRouter, Groq, `localhost:11434` for
Ollama). MCP clients get the server URL from the HTTP transport built in the same file.

## Example requests

Every call carries `examples`: concrete requests synthesized from what was resolved, so the
report reads like the traffic the code would actually send. `--curl` prints them as commands.

```
# lib/api/domains/claim-dot-link-domain.ts:143  vercel PATCH /v3/domains/{domain}  (confidence 0.50)
# minimal
curl -X PATCH 'https://api.vercel.com/v3/domains/yonder.example.org?teamId=dgsko5l3' \
  -H 'authorization: Bearer <token>' \
  -H 'content-type: application/json' \
  --data '{"op":"update","zone":true}'
```

- **Values are typed, then named.** Path segments, query parameters and body properties get the
  checker's shape (`{id}` as `number`, `status` as `"open" | "closed"`), and the synthesizer fills
  it with deterministic pseudo-random content chosen by name: `email` → an address, `createdAt` →
  an ISO date, `per_page` → a small integer, `userId` → an id, `iban`, `currency`, `zip`, and so on.
  Anything else becomes random words or integers. The identifier that flowed into a property is
  used as a hint (`{ username: email }` is an email).
- **Credentials are never invented.** Keys and headers that look like secrets (`token`, `api_key`,
  `password`, `authorization`, `cookie`) become `<name>` placeholders; the auth scheme picks
  `Bearer <token>`, `Basic <base64(user:password)>` or `<api-key>`.
- **Variants.** `minimal` sends required properties with the first enum / union branch; `full`
  adds optional properties (when the type has some); `alt` switches enum values, union branches and
  booleans. Identical requests are deduplicated; `--examples <n>` caps the count.
- **What stays visible.** A host that could not be resolved is left as `https://{baseUrl}/…` or
  `https://{env:API_URL}/…`; a `DYNAMIC` method is rendered as `POST` when a body exists, `GET`
  otherwise. Values are seeded by the call id, so they are stable across runs and diffs.
- **Query parameters** come from the URL template (`?state=open&per_page=${n}`), `params` /
  `searchParams` objects, and `url.searchParams.set("k", v)` calls; header values are kept when
  they are literals (`x-api-version: 2024-06-01`) and never when they look like credentials.

## How resolution works

- **URL** — string literals, template literals, `+` concatenation, `new URL(path, base)`,
  same-file and imported constants, `as const` config objects, enums, `process.env.X`
  (with hints from `.env.example`), local helpers that return a URL (`apiUrl("sendMessage")`,
  one level, arguments substituted), `this.baseUrl` set in the constructor or as a parameter
  property default, and parameter defaults. Unresolvable segments become `{name}` placeholders and
  are listed under `dynamic` with their origin (`param`, `call`, `env`, `unknown`).
- **Body** — object literals first (literal values give `enum`), spreads merged, computed
  keys flagged; anything else goes through the checker's declared type (`fromType` names it).
  `JSON.stringify`, `URLSearchParams`, `FormData` and `.append()` calls are unwrapped.
  `any` degrades to `dynamic` honestly.
- **Provider** — from the SDK registry, else the host through `src/normalize/providers.json`
  (`id`, `name`, `hosts`, `packages`; an exact host wins over the longest matching suffix). An env
  URL with a literal default (`process.env.X ?? "https://api.langdock.com/v1"`) keeps `envName` and
  takes the default's host and base path; with no value at all, the env var's name is used
  (`OPENROUTER_BASE_URL` -> `openrouter`, `providerSource: "env-name"`, lower confidence). A host
  that still holds a placeholder never becomes a provider: it is `internal` (localhost), `env:<NAME>`
  or `unknown`. `internal` (relative URLs, localhost) is the repo's own backend, a resolved answer.
  `apicalls providers` prints the table as JSON for the review and the evaluation to share names.
- **Headers** — names only, values are dropped. `authScheme` is inferred from the key and the
  literal prefix of the value (`Bearer `, `Basic `, `x-api-key`).
- **Wrappers** (two hops) — a local function or class method whose body performs an HTTP call
  *and* whose parameters flow into it is treated as an HTTP client; calls to it are reported
  at the call site with `via: "wrapper:<name>"` and the caller's arguments substituted. A
  function that passes its parameters to such a wrapper is one too (`latest()` -> `tlsFetch(url)`
  -> `doFetch(url)` -> `fetch`, reported at `latest()` with `via: "wrapper:tlsFetch>doFetch"`).
  `fn.call(this, …)` invocations are followed (n8n's `GenericFunctions` style), a TypeScript
  `this` parameter is skipped, and `const { body, ...rest } = options` inside the wrapper is
  resolved back to the caller's object.
- **String bodies** — `` `a=${x}&b=1` `` with a form content type becomes a form shape; `body ?
  JSON.stringify(body) : undefined`, `.toString()` and `qs.stringify(obj)` are unwrapped.
- **Specs** — with `--specs <dir>` (a directory of `<provider>.{json,yaml}` or a checkout of
  [APIs-guru/openapi-directory](https://github.com/APIs-guru/openapi-directory)) the path
  template is matched to an operation. `--validate` adds deterministic findings: unknown
  property, missing required, type mismatch, enum mismatch, deprecated.

## Confidence

Additive rules, clamped to `[0, 1]`: SDK registry hit +0.6, literal or resolved-constant host
+0.3, env host with `.env.example` hint +0.15, named dynamic path segments +0.1, body from an
object literal +0.2, from a declared type +0.15, body `any`/unknown −0.2, via wrapper −0.1,
spec match +0.1. Unknown or relative hosts are capped at 0.4. The table hides `< 0.3`
by default (`--min-confidence`); JSON keeps everything.

## Output

The report is validated by the zod schema in `src/report/schema.ts` (the contract for the
next stage), one call at a time: a call that does not fit is dropped and the rest of the report
is still written. The scan never stops because of one file or one call.

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
  "complete": false
}
```

- `skipped`: `parse-error` (a syntax error, or an import whose module specifier is not a string
  literal) and `internal-error` (a detector threw) files are not scanned. Files left out by
  `--exclude` (`excluded`) or `--include` (`not-included`) are listed too, or only counted above 200.
  Test files, mocks, declarations and build output are out of scope and not counted. Every source
  file under the directory is scanned, also outside the tsconfig `include`.
- `droppedCalls`: calls that failed the report schema (`schema-invalid`, with the zod path) or
  made the resolver throw (`internal-error`).
- `unfollowed`: a fetch function received from outside (`this.fetchFn(url)`, `deps.fetchUpstream(url)`),
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
never reads as "no Supabase". Each known SDK package (the `packages` of `providers.json`) that a
covered `package.json` declares (`dependencies`, `peerDependencies`) or a scanned file imports
(type-only imports aside) gets a row:

```json
{ "package": "@notionhq/client", "provider": "notion", "supported": false, "declared": true,
  "imported": true, "importSites": 41, "calls": 0, "status": "unsupported" }
```

`ok` (registry and calls), `unsupported` (imported, no registry: its calls are missed),
`imported-no-calls` (registry but no call: a wrapper, or a detection bug), `declared-not-imported`
(probably unused). The table prints one `⚠` line per `unsupported` and `imported-no-calls`
package. Calls count for the package actually imported (`@supabase/ssr`, `@sentry/nextjs`).
`--changed-since` scans have no coverage section.

**Exit codes:** `0` complete scan, `2` partial scan (the report is still written), `1` fatal error
(for example the directory does not exist). A denylist walker replaces any secret-looking string (`sk_live_`, `AKIA`, `ghp_`,
JWTs, long hex) with `<redacted>` and counts them in `stats.redacted`.

## Registries

`src/detect/registry/*.json` map SDK member chains to endpoints. They are hand-written for
v0 (`generatedFrom: "manual"`). Besides `pathArgs` / `bodyArg` / `queryArg`, a method can set its
own `host` and `auth`, read its body from a property of an argument (`bodyProp`), and name where
each path placeholder comes from in `params`: `arg:N`, `instance:N` (the builder it is called on,
`from(table)`) or `ref:N` (a Firebase reference). With `inlinePathLiterals`, literal values are
written into the path; `instance.urlArg` names the constructor argument that holds the base URL.
An alias ending in `/*` covers a whole scope (`@sentry/*`). `pnpm gen:registry stripe|openai` regenerates them from the
vendor OpenAPI specs (network) and merges into the existing file; review the diff.

## Regression fixtures and recall

Every directory under `tests/fixtures/` with an `expected.json` is a regression fixture: synthetic
code (invented names, public provider hosts only, never customer code) with the calls a scan must
find (`file`, `line`, `provider`). An empty `calls` list marks a negative fixture (`data:` URLs,
fetch overrides, `<img src>`, stub providers); `orUnfollowed` accepts a `diagnostics.unfollowed`
entry instead of a call; `todo` (an issue URL) parks a fixture whose feature is not built yet.
`tests/recall.test.ts` scans them all, snapshots their calls and prints `recall 1.00, false calls 0`
(also to the GitHub step summary). It fails when recall drops below `tests/recall-baseline.json`
or a negative fixture gives a call; raise the baseline when recall improves.

## Evaluation

```
pnpm eval                     # clones eval/repos.json shallowly, scans, writes eval/out/<repo>.json + summary
pnpm eval dub                 # one repo
pnpm eval:score sample dub 100  # stratified sample -> eval/label/dub.csv to fill by hand
pnpm eval:score               # precision per field / bucket, recall when <repo>.missed.txt exists
```

Labeling protocol is in `eval/label/README.md`.

## Known approximations

- A conditional between two static URLs (`prod ? A : B`) resolves to the first branch.
- Wrapper expansion stops at two hops; the definition-site call is still reported and deeper
  call sites are listed in `diagnostics.unfollowed` (`wrapper-depth`).
- One call site that picks its host from a table (``fetch(`${PRESETS[name].baseUrl}/models`)``)
  is one call with an unknown host: the candidate hosts are not listed.
- `data:` / `blob:` URLs (`canvas.toDataURL()`, `URL.createObjectURL()`) and calls forwarded by
  a `window.fetch = ...` override are not requests and are not reported.
- Twilio and Octokit path parameters that come from the client instance stay as placeholders
  with origin `sdk`.
- Spec matching treats id-looking literal segments as parameters.

## Development

```
pnpm install
pnpm test          # vitest (fixtures snapshot + unit)
pnpm lint          # eslint, max 300 lines/file, 50 lines/function
pnpm typecheck
pnpm build         # tsup -> dist/
```
