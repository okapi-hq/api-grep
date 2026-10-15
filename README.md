# api-grep

[![CI](https://github.com/okapi-hq/api-grep/actions/workflows/ci.yml/badge.svg)](https://github.com/okapi-hq/api-grep/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

**Find every outbound HTTP and SDK call in a codebase, without running it.**

Point api-grep at a repository and it lists the external APIs the code talks to: the provider, the method and
path, the names and types of what each request sends, and how it authenticates. It reads TypeScript, JavaScript,
HTML, Python, PHP, Kotlin, Java, Go, Rust and shell scripts. Nothing is executed and nothing leaves your machine.

```sh
docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo
```

## Supported languages

<table align="center">
  <tr>
    <td align="center" width="88"><a href="docs/languages.md#typescript-javascript-and-html"><img src="https://cdn.simpleicons.org/typescript" width="40" height="40" alt="TypeScript"><br><sub><b>TypeScript</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#javascript-and-html"><img src="https://cdn.simpleicons.org/javascript" width="40" height="40" alt="JavaScript"><br><sub><b>JavaScript</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#javascript-and-html"><img src="https://cdn.simpleicons.org/html5" width="40" height="40" alt="HTML"><br><sub><b>HTML</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#python"><img src="https://cdn.simpleicons.org/python" width="40" height="40" alt="Python"><br><sub><b>Python</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#php"><img src="https://cdn.simpleicons.org/php" width="40" height="40" alt="PHP"><br><sub><b>PHP</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#kotlin"><img src="https://cdn.simpleicons.org/kotlin" width="40" height="40" alt="Kotlin"><br><sub><b>Kotlin</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#java"><img src="https://cdn.simpleicons.org/openjdk/ED8B00" width="40" height="40" alt="Java"><br><sub><b>Java</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#go"><img src="https://cdn.simpleicons.org/go" width="40" height="40" alt="Go"><br><sub><b>Go</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#rust"><img src="https://cdn.simpleicons.org/rust/CE422B" width="40" height="40" alt="Rust"><br><sub><b>Rust</b></sub></a></td>
    <td align="center" width="88"><a href="docs/languages.md#shell"><img src="https://cdn.simpleicons.org/gnubash" width="40" height="40" alt="Shell"><br><sub><b>Shell</b></sub></a></td>
  </tr>
</table>

## Example

Two files from a small shop backend:

```ts
// billing/stripe.ts
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCustomer(email: string, userId: string) {
  return stripe.customers.create({ email, name: "Ada", metadata: { userId } });
}
export const getIntent = (id: string) => stripe.paymentIntents.retrieve(id);
```

```python
# billing/notify.py
SLACK_URL = "https://slack.com/api/chat.postMessage"

def notify(channel: str, text: str):
    return requests.post(SLACK_URL, json={"channel": channel, "text": text},
                         headers={"Authorization": f"Bearer {os.environ['SLACK_TOKEN']}"})
```

`api-grep scan .` prints:

```
┌──────┬────────┬──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┐
│ line │ method │ provider         │ path                                     │ body                               │ dyn │
├──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┤
│ billing/notify.py  python                                                                                              │
├──────┬────────┬──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┤
│ 7    │ POST   │ slack            │ /api/chat.postMessage                    │ {channel, text}                    │ 2   │
├──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┤
│ billing/stripe.ts  typescript                                                                                          │
├──────┬────────┬──────────────────┬──────────────────────────────────────────┬────────────────────────────────────┬─────┤
│ 6    │ POST   │ stripe sdk       │ /v1/customers                            │ {email, name, metadata}            │ 2   │
├──────┼────────┼──────────────────┼──────────────────────────────────────────┼────────────────────────────────────┼─────┤
│ 9    │ GET    │ stripe sdk       │ /v1/payment_intents/{intent}             │ -                                  │ 1   │
└──────┴────────┴──────────────────┴──────────────────────────────────────────┴────────────────────────────────────┴─────┘
3 calls in 2 files; languages: typescript=2, python=1; providers: stripe=2, slack=1
scanned 2/2 files (typescript 1, python 1), complete
```

The Stripe SDK call is reported as the HTTP request it sends, `POST /v1/customers`. `dyn` counts the parts that
depend on runtime values, like `email` here.

## Why

Ask a team which third-party APIs a service calls, and with what data, and someone ends up grepping the code by
hand. The dependency list doesn't answer it: `package.json` says you use `axios`, not that you post user emails to a
CRM. api-grep reads the code and answers it. Use it for:

- Auditing a codebase you inherited, are reviewing or are about to acquire: every vendor it calls, in one report.
- Reviewing pull requests. `--changed-since origin/main` scans only the files a branch changed (and the files that
  import them).
- Privacy reviews and subprocessor lists. The body shape shows which fields go to which provider (`email`,
  `userId`), and never their values.
- Trying an endpoint. `--curl` prints a curl command for each call, with invented values and credential
  placeholders.
- Feeding other tools. The JSON report has a versioned schema, and it states facts only: what the code shows and
  where each part came from. Scoring is up to you.

## How it works

1. It parses every source file. TypeScript, JavaScript and inline HTML scripts go through the TypeScript type
   checker, so a callee is known by its declaration, not its name: `import http from "axios"` is still axios, and a
   local function called `fetch` is not `fetch`. Python, PHP, Kotlin, Java, Go and Rust are parsed with tree-sitter into a shared intermediate form;
   shell scripts with tree-sitter's bash grammar, their command lines read as they would run.
2. It looks for calls to HTTP clients (fetch, axios, requests, Guzzle, OkHttp, Retrofit and [many
   more](docs/detection.md)) and to about 250 SDK packages (Stripe, OpenAI, Anthropic, AWS, Firebase, Supabase,
   Shopify...), each described by a registry of its methods and the requests they send.
3. URLs, bodies and headers are followed through constants, env vars, string building, config files,
   helper functions that wrap a client, and clients injected by Spring, Dagger or Koin. A value that can't be known
   becomes a `{placeholder}` and is listed under `dynamic`.
4. `diagnostics` lists the files and calls the scan couldn't read. `coverage` lists the
   SDKs your manifests declare and whether api-grep supports them, so "0 calls" never hides "not supported", and the
   API hosts your code names that no call found explains, a measure of what the scan may miss.

There is no AI and no network access, and the same code always gives the same report.

## Quick start

With Docker:

```sh
docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo
docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo --json > report.json
```

From source (Node.js 20+ and [pnpm](https://pnpm.io)):

```sh
git clone https://github.com/okapi-hq/api-grep.git && cd api-grep
pnpm install && pnpm build
node dist/cli.js scan path/to/your-repo
```

## Usage

```sh
api-grep scan <dir>                                # table
api-grep scan <dir> --json                         # JSON report on stdout
api-grep scan <dir> --curl                         # one curl command per example request
api-grep scan <dir> --changed-since origin/main    # only files changed since a git ref
api-grep scan <dir> --language python,php          # some languages only
api-grep providers                                 # known providers, their hosts and SDK packages
api-grep schema                                    # JSON Schema of the report
api-grep serve --port 8080                         # HTTP server that scans uploaded archives
```

| option | description |
|---|---|
| `--language <ids>` | `typescript`, `javascript`, `html`, `python`, `php`, `kotlin`, `java`, `go`, `shell`, `rust`, comma-separated (default: all with files) |
| `--json` | print the JSON report instead of the table |
| `--out <file>` | write the JSON report to a file |
| `--curl` | print example requests as curl commands |
| `--examples <n>` | example requests per call (default 3, `0` turns them off) |
| `--changed-since <ref>` | only scan files changed since a git ref, plus their direct importers |
| `--include <glob>` / `--exclude <glob>` | filter scanned files (repeatable); excluded files are still read to resolve imports |
| `--tsconfig <path>` | tsconfig to load (default: the nearest one, up to the repository root) |
| `--no-wrappers` | don't report calls to helper functions at their call sites |

Exit codes: `0` complete scan, `2` partial scan (the report is still written, see
[diagnostics](docs/report.md#diagnostics)), `1` fatal error.

Large TypeScript monorepos are scanned in batches and fit in a 2 GB heap. The CLI asks for 8 GB to go faster; set
`API_GREP_HEAP_MB` to change that, or `0` to keep Node's default.

api-grep is also a library: `scan`, `finalizeReport`, `toJson`, `toTable`, `toCurl` and the report schema are
exported from [`src/index.ts`](src/index.ts).

## The report

`--json` gives one document with a `calls` array, plus `stats`, `diagnostics` and `coverage`. The first call of the
example, trimmed:

```json
{
  "location": { "file": "billing/stripe.ts", "line": 6, "col": 10, "language": "typescript" },
  "client": "sdk",
  "sdk": { "package": "stripe", "version": "^22.6.1", "chain": "customers.create" },
  "provider": "stripe",
  "method": "POST",
  "urlTemplate": "https://api.stripe.com/v1/customers",
  "authScheme": "bearer",
  "bodyEncoding": "form",
  "body": {
    "type": "object",
    "properties": {
      "email": { "type": "string", "hint": "email" },
      "name": { "type": "string", "enum": ["Ada"] },
      "metadata": { "type": "object", "properties": { "userId": { "type": "string" } } }
    }
  },
  "dynamic": [
    { "where": "body", "name": "email", "origin": "param" },
    { "where": "body", "name": "userId", "origin": "param" }
  ]
}
```

Calls can also carry the model a request asks for (`gpt-4o`, `claude-sonnet-4`), the GraphQL, JSON-RPC or SOAP
operation it sends, the headers an interceptor adds, and example requests. Every field is described in
[docs/report.md](docs/report.md). The format is a JSON Schema, [`schema/report.v1.json`](schema/report.v1.json),
versioned separately from the tool.

## What it reads

| language | HTTP clients |
|---|---|
| TypeScript, JavaScript | `fetch`, axios, got, ky, Node `http`, jQuery, `XMLHttpRequest`, node-soap, the Vercel AI SDK |
| HTML | inline `<script>` blocks and `<form>` actions |
| Python | requests, httpx, aiohttp, urllib, urllib3, zeep |
| PHP | Guzzle, Laravel `Http`, Symfony HttpClient, curl, PSR-18, streams, WordPress, `SoapClient` |
| Kotlin, Java | OkHttp, `java.net.http`, `HttpURLConnection`, Ktor, Spring `RestTemplate` / `WebClient` / `RestClient`, Feign, Retrofit, Apache HttpClient, JAX-RS, AsyncHttpClient, Unirest, Vert.x |
| Go | `net/http` (`http.Get` / `Post` / `PostForm`, `http.NewRequest` sent by any client), go-retryablehttp, fhttp, Resty |
| Shell | curl, wget and HTTPie command lines in `.sh` / `.bash` / `.zsh` files and `#!` scripts, with the script's variables and wrapper functions |
| Rust | reqwest (async and blocking), ureq, awc, surf, isahc |

GraphQL clients (Apollo, urql, Relay, graphql-request, gql), JSON-RPC clients (viem, ethers, web3, Solana) and
Shopify's SDKs report the operation they send. The full list of SDKs per language is in
[docs/sdk-support.md](docs/sdk-support.md), and the patterns each front end follows are in
[docs/detection.md](docs/detection.md).

## Limitations

It's static analysis, so some things stay out of reach. A URL built from runtime data shows up as a placeholder
(`https://{baseUrl}/users`). A conditional between two static URLs reports the first one. An SDK without a registry
is listed in `coverage`, not as calls. Python and PHP have no type checker, so an HTTP client passed around without a
type is listed in `diagnostics` instead of guessed. The full list is in
[docs/detection.md](docs/detection.md#limitations).

## Privacy and safety

Reports hold shapes, not data: values that look like secrets (`sk_live_...`, AWS keys, JWTs) are replaced with
`<redacted>`, and credential headers keep their name only. The scanned repository is treated as hostile input. It's
parsed and never run, symlinks can't lead the scan outside it, and anything it controls is escaped before it
reaches your terminal. Details: [docs/security-model.md](docs/security-model.md).

## Running it as a service

`api-grep serve` takes a `.tar.gz` of a repository over HTTP and returns the report, scanning each archive in an
isolated child process. The Docker image runs it by default:

```sh
export API_GREP_TOKEN=$(openssl rand -hex 32)
docker run --rm -p 8080:8080 -e API_GREP_TOKEN ghcr.io/okapi-hq/api-grep

# from another terminal, in the repository to scan
git archive --format=tar.gz HEAD | curl --data-binary @- -H "authorization: Bearer $API_GREP_TOKEN" \
  -H "content-type: application/gzip" http://localhost:8080/v1/scan
```

Routes, limits, environment variables and image tags: [docs/server.md](docs/server.md).

## Accuracy

The scanner is measured on 48 open-source repositories in five languages ([`eval/repos.json`](eval/repos.json),
results in [`eval/results.md`](eval/results.md)), with hand-labeled samples for precision. CI also runs a recall
check over regression fixtures. How to run the evaluation: [eval/README.md](eval/README.md).

## Documentation

- [docs/detection.md](docs/detection.md): clients, SDKs and code patterns per language, how calls are resolved,
  limitations
- [docs/report.md](docs/report.md): the JSON report, field by field
- [docs/sdk-support.md](docs/sdk-support.md): supported SDKs per language
- [docs/server.md](docs/server.md): the HTTP server and Docker image
- [docs/security-model.md](docs/security-model.md): redaction and scanning untrusted code
- [docs/languages.md](docs/languages.md): architecture and per-language internals

## Contributing

New SDK registries and languages are the most useful contributions. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup,
tests and how to add a registry. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md); to report a
vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
