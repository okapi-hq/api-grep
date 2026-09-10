# apicalls

Static extractor of outbound HTTP and SDK calls in TypeScript repositories.
Point it at a repo and it prints every outbound call it can find: provider, method,
path template, the *shape* of the payload (names and types, never values), and a
`dynamic` list of what could not be known statically. No AI, no network, no runtime.

```
pnpm dev scan ../some-repo                  # table
pnpm dev scan ../some-repo --json           # Report JSON on stdout
pnpm dev scan ../some-repo --out report.json --changed-since origin/main
pnpm dev scan ../some-repo --specs ./specs --validate
```

Or after `pnpm build`: `node dist/cli.js scan <dir>`.

## What it detects

| client | patterns |
|---|---|
| fetch | global `fetch`, `node-fetch`, `undici.fetch`, `cross-fetch`, `fetch(new Request(...))` |
| axios | `axios.<verb>()`, `axios(cfg)`, `axios.request(cfg)`, instances from `axios.create({ baseURL })`, aliased and `require`d imports |
| got / ky | `got(url, opts)`, `got.<verb>()`, `got.extend({ prefixUrl })`, `ky.create({ prefixUrl })`, `json` / `form` / `body` / `searchParams` |
| node http | `https.request(opts)`, `https.get(url)` |
| sdk | registry-driven: `stripe`, `openai`, `@octokit/rest`, `@slack/web-api`, `twilio`, `@aws-sdk/client-s3`, `aws-sdk` v2 |

Callees are identified by declaration through the type checker, never by name, so a
shadowed `fetch` is ignored and `import http from "axios"` is still axios. SDK instances
are followed through `const stripe = new Stripe()`, exported instances in other files,
class properties (`this.stripe`), and typed parameters (`stripe: Stripe`) when the
package's types are installed.

## How resolution works

- **URL** — string literals, template literals, `+` concatenation, `new URL(path, base)`,
  same-file and imported constants, `as const` config objects, enums, `process.env.X`
  (with hints from `.env.example`). Unresolvable segments become `{name}` placeholders and
  are listed under `dynamic` with their origin (`param`, `call`, `env`, `unknown`).
- **Body** — object literals first (literal values give `enum`), spreads merged, computed
  keys flagged; anything else goes through the checker's declared type (`fromType` names it).
  `JSON.stringify`, `URLSearchParams`, `FormData` and `.append()` calls are unwrapped.
  `any` degrades to `dynamic` honestly.
- **Headers** — names only, values are dropped. `authScheme` is inferred from the key and the
  literal prefix of the value (`Bearer `, `Basic `, `x-api-key`).
- **Wrappers** (one hop) — a local function or class method whose body performs an HTTP call
  *and* whose parameters flow into it is treated as an HTTP client; calls to it are reported
  at the call site with `via: "wrapper:<name>"` and the caller's arguments substituted.
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
next stage). A denylist walker replaces any secret-looking string (`sk_live_`, `AKIA`, `ghp_`,
JWTs, long hex) with `<redacted>` and counts them in `stats.redacted`.

## Registries

`src/detect/registry/*.json` map SDK member chains to endpoints. They are hand-written for
v0 (`generatedFrom: "manual"`). `pnpm gen:registry stripe|openai` regenerates them from the
vendor OpenAPI specs (network) and merges into the existing file; review the diff.

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
- Wrapper expansion stops at one hop; the definition-site call is still reported.
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
