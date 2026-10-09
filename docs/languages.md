# Languages

`apicalls` started as a TypeScript scanner. This document describes how it reads several languages, what each one
supports, and how to add the next one. The SDKs each language supports are listed in
[`sdk-support.md`](sdk-support.md) (generated).

| language | status | parser | SDK ecosystem | manifests |
|---|---|---|---|---|
| TypeScript | supported | ts-morph (TypeScript type checker) | npm | `package.json` |
| Python | supported | tree-sitter + shared engine | PyPI | `requirements*.txt`, `requirements/*.txt`, `pyproject.toml` (PEP 621, Poetry), `Pipfile`, `setup.cfg`, `setup.py` |
| PHP | planned (next pull request) | tree-sitter + shared engine | Packagist | `composer.json` |

## Goals

- **One report for a whole repository.** A repository often holds a TypeScript front end and a Python or PHP back end.
  `apicalls scan` reads every supported language it finds (or the ones given with `--language`) and writes one report.
- **Say where each call comes from.** Every call carries `location.language`; `stats.byLanguage` counts calls per
  language, `diagnostics.languages` counts files seen and scanned per language, and each `coverage.sdks` row names its
  `ecosystem` (`npm`, `pypi`), so the same package name in two ecosystems (`openai`) is two rows.
- **Same report, same rules.** A call found in Python is described exactly like one found in TypeScript: the same
  `Call` schema, provider table, confidence rules, example requests, curl output, spec validation, secret redaction,
  diagnostics and SDK coverage. Only detection and resolution are language specific.
- **SDKs differ per language.** Each language has its own registries, keyed by the package name its ecosystem uses
  (`sentry-sdk` on PyPI, `@sentry/react` on npm), with the method names its SDK exposes (`chat_postMessage`,
  `Customer.create`). The provider ids, hosts and paths stay the same, so the reports line up.
- **Stay static.** No code is executed, no network is used, no AI is involved.

## Architecture

```
            ┌──────────────────────────── language front ends ──────────────────────────────┐
files ──▶   │ TypeScript: ts-morph checker ─▶ detect ─▶ resolve ──┐                          │
            │ Python / PHP / …: tree-sitter ─▶ lower to IR ─▶ IR engine (detect, resolve) ──┤──▶ Call[]
            └──────────────────────────────────────────────────────────────────────────────────┘
Call[] ──▶ specs ─▶ examples ─▶ schema check ─▶ redaction ─▶ JSON / table / curl     (shared)
           stats, diagnostics, SDK coverage per ecosystem                              (shared)
```

- `src/lang/types.ts` defines a `LanguageFrontEnd`: an id, an ecosystem, file extensions and a `scan` that returns `Call`s,
  files seen and scanned, and coverage rows. `src/lang/index.ts` lists the languages; `src/scan.ts` runs each one and
  merges the results.
- `src/assemble.ts` turns what a front end resolved (URL shape, method, body, headers, query, SDK match) into the report
  `Call`: provider, confidence and id are decided there, the same way for every language.
- Language-neutral helpers shared by every front end: `src/resolve/parts.ts`, `url-shape.ts` (URL templates and host
  classification), `header-names.ts`, `shape-utils.ts`, `sdk-template.ts` (registry paths, `inlinePathLiterals`,
  `basePath`, code-given base URLs) and `src/coverage.ts`.

### TypeScript

The original pipeline (`src/detect`, `src/resolve`, `src/wrappers`) is the TypeScript front end, wrapped by
`src/lang/typescript/`. It reads code through the type checker, so callees are identified by declaration and bodies by
their declared types.

### Tree-sitter languages: the IR engine

Python and PHP have no type checker to lean on, but they share most of what a scanner needs. Each is parsed with
[tree-sitter](https://tree-sitter.github.io) (WebAssembly grammars, no native build) and **lowered** into a small
language-neutral model (`src/lang/ir/model.ts`):

- expressions: literals, interpolated strings (`f"..."`, `"$x"`), concatenation, `or` / `??` defaults, format calls
  (`%`, `.format()`, `sprintf`), environment reads with their default, names, attributes, indexes, calls with keyword
  arguments and spreads, dicts / associative arrays, lists, `self` / `$this`, qualified class names, function values;
- scopes: functions with parameters (types, defaults), ordered assignments, returns and the calls they make; classes
  with methods, fields (`self.x = ...`, class attributes, typed and promoted properties) and annotated fields; modules
  with their imports.

The engine (`src/lang/ir/`) then works on that model only:

| file | role |
|---|---|
| `project.ts` | index of every file of the language; name lookup (locals by position, parameters, closures, module globals, imports, project modules, classes, base classes) |
| `chain.ts` | what a callee is: `self.client.chat.completions.create` becomes `[openai, OpenAI(), chat, completions, create()]`, following variables, fields, typed parameters (`client: OpenAI`), factories (`def get_client(): return OpenAI()`), `with ... as`, `or` defaults and external base classes |
| `evaluate.ts`, `format.ts` | string values as static / env / dynamic parts, like the TypeScript evaluator: constants across files, env defaults, `self.base_url` set in the constructor, parameter defaults, URL helpers and lambdas |
| `shape.ts`, `types.ts`, `request.ts` | body, query and header shapes: dict literals and spreads, serializers (`json.dumps`, `urlencode`), declared types (dataclass, TypedDict, pydantic models) |
| `sdk.ts` | SDK registry matching on chains (instances, builders, module-level APIs) |
| `http.ts` | table-driven HTTP clients (functions, client objects, fluent modifiers) |
| `detect.ts`, `wrappers.ts` | detection per function, two-hop wrapper expansion, `injected-client` / `injected-fetch` / `wrapper-depth` diagnostics |
| `build.ts`, `scan.ts` | report `Call`s, the scan driver (per-file errors are diagnostics, never fatal) and SDK coverage |

A tree-sitter language is then mostly data plus a lowering (`src/lang/python/`):

- `lower*.ts`: syntax tree to the IR, including the language's environment reads and string formatting;
- `clients.json`: HTTP clients, as tables (functions, client constructors, keyword / option names and what they carry);
- `registry/*.json`: SDK registries;
- `manifests.ts` and `modules.json`: declared packages, their versions, and import names that differ from the package;
- `index.ts`: the `IrLanguage` (excludes, passthrough calls, serializers, custom detectors such as `urllib.request`).

### Registries

Tree-sitter languages use the TypeScript registry format (`RegistryEntry` / `MethodSpec`) with a few additions, typed
as `IrRegistryEntry` / `IrMethodSpec` in `src/lang/ir/language.ts`:

- `imports`: dotted import roots (`openai`, `google.genai`, `sentry_sdk`); `package` is the name a manifest declares;
- `instance.names` may be dotted (`firestore.client`), `instance.urlArg` reads `kw:<name>` and alternatives
  (`0|kw:supabase_url`), `instance.select` picks a service out of a shared factory (`boto3.client("s3")`);
- `builders`: call segments that only narrow a request (`collection`, `document`, `with_raw_response`);
- bodies from keyword arguments: `bodyKwargs`, `bodyKw` (`params=` of StripeClient), `queryKwargs`;
- path parameter sources `kw:<name>`, `seg:<segment>:<N>`, `chain:<a>,<b>`; `arg:N` also matches the keyword argument
  named like the placeholder.

The Python Stripe registry is derived from the TypeScript one (itself generated from Stripe's OpenAPI spec) by
`pnpm gen:stripe-ports`. The other Python registries were written against each SDK's own request code; their notes
(versions checked, calls that send nothing) are in each file's `$comment` and `generatedFrom`.

## Python

**Detected:** `requests` (functions and `Session`), `httpx` (functions, `Client` / `AsyncClient` with `base_url`),
`aiohttp` (`ClientSession`, positional or keyword base URL), `urllib.request` (`urlopen(url, data)`,
`urlopen(Request(url, data, headers, method=...))`), `urllib3` (`PoolManager().request`), and the SDKs in
[`sdk-support.md`](sdk-support.md) (OpenAI and Azure OpenAI, Anthropic and its Bedrock / Vertex clients, Google Gen AI,
Google Generative AI, Supabase, Firebase Admin, Google Cloud Firestore, Sentry, Stripe, boto3 S3 and Bedrock runtime,
Twilio, Slack, Resend, PostHog, Mistral, Groq, Cohere, ElevenLabs, Convex).

**Resolved:** f-strings, `+`, `%`, `.format()`, `"/".join([...])`, `urljoin`, `os.getenv("X", default)`,
`os.environ["X"]` / `.get`, python-decouple `config()` and django-environ `env()`, module constants (also imported from
project modules, relative imports and `src/` layouts), class attributes, `self.x` set in any method, parameter defaults,
`x or "https://..."` defaults, URL helpers (`def api_url(m): return f"..."`, lambdas), local annotations
(`db: Client = ctx.db`). Bodies come from dict literals, `**spreads`, `dict(...)`, `json.dumps`, `urlencode`,
`.model_dump()`, and declared dataclass / TypedDict / pydantic types.

**Out of scope by default:** `tests/`, `test/`, `test_*.py`, `*_test.py`, `conftest.py`, virtualenvs (`.venv`, `venv`,
`site-packages`), caches. Files a scan excludes are still read so imports resolve through them, as in TypeScript.

**Limitations:**

- No type inference beyond annotations: an untyped parameter used as a client (`def run(session): session.post(url)`)
  is listed in `diagnostics.unfollowed` as `injected-client`.
- SDK methods passed as callbacks (`retry(stripe.Customer.create, email=...)`) are not followed; the SDK shows as
  `imported-no-calls` in coverage.
- `getattr(client, name)(...)`, `**kwargs` forwarded through several layers, and module-level configuration
  (`openai.base_url = ...`) are not followed.
- Some SDK endpoints depend on an argument (`stream=True` switching paths on Bedrock / Vertex, supabase `rpc(get=True)`);
  the registry lists the default form.

## How the open issues apply to each language

| issue | TypeScript | Python | PHP (planned) |
|---|---|---|---|
| #3 Supabase, Firebase, Sentry registries; no-crash scans | done | supabase-py (tables, rpc, auth, storage, functions), firebase-admin (Firestore references, Auth, FCM), sentry-sdk (`capture_*`, not `init`); per-file parse / internal errors | kreait/firebase-php, google/cloud-firestore, sentry/sentry (+ Laravel, Symfony); no official Supabase SDK |
| #4 diagnostics | done | parse errors, internal errors, dropped calls, `injected-client`, `injected-fetch`, `wrapper-depth`, per-language file counts | same |
| #5 regression fixtures and recall | done | `tests/fixtures/python/**/expected.json` are part of the recall check | `tests/fixtures/php/**` |
| #6 provider roadmap | done | registries for every P1 / P2 provider with a Python SDK; `providers.json` lists PyPI packages per provider | Packagist packages per provider |
| #7 SDK coverage | done | PyPI manifests, import names (`modules.json`), `ecosystem: "pypi"` | `composer.json`, namespaces per package |
| #8 provider resolution | done | env defaults, env var names, URL helpers, class base URLs; no template in `provider` | `env('X', 'default')`, `getenv() ?: '...'`, Laravel `config()` files, class constants |

## PHP plan (next pull request)

PHP reuses the IR engine; the work is a lowering, client tables, registries and manifests.

- **Parsing:** `tree-sitter-php` (the grammar with HTML, so templates parse). Lowering handles namespaces and `use`
  (classes, functions, constants, groups, aliases) into qualified names, `$this`, `self::` / `static::`, static calls
  and properties, `new`, promoted constructor properties, typed properties and parameters, arrays (keyed arrays are
  dicts, positional ones lists), single / double-quoted and heredoc strings with interpolation, `.` and `.=`, `??`,
  `?:`, `sprintf`, closures (`use (...)`) and arrow functions. PHP functions do not see file-level `$variables`, but
  `define()` / `const` and functions are global (`sharedGlobals`).
- **HTTP clients:** Guzzle (`new Client(['base_uri' => ...])`, verbs, `request`, `*Async`, options `json`,
  `form_params`, `multipart`, `body`, `query`, `headers`, `auth`), Laravel `Http` facade (fluent `withToken`,
  `withBasicAuth`, `withHeaders`, `asForm`, `asMultipart`, `baseUrl`, `withQueryParameters`), Symfony HttpClient
  (`HttpClient::create()`, `createForBaseUri`, `HttpClientInterface` injection, options `json`, `body`, `query`,
  `headers`, `auth_bearer`, `auth_basic`), curl (`curl_init` / `curl_setopt` / `curl_setopt_array` / `curl_exec`),
  `file_get_contents` on an `http(s)` URL with a `stream_context_create` context, WordPress `wp_remote_get`,
  `wp_remote_post`, `wp_remote_request`.
- **Environment:** `getenv()`, `$_ENV[...]`, `$_SERVER[...]`, Laravel / Symfony `env('X', 'default')`, and Laravel
  `config('services.x.url')` read from `config/services.php`.
- **Registries (drafted):** stripe-php (ported from the TypeScript registry: `$stripe->customers->create()` and the
  static `\Stripe\Customer::create()`), openai-php (+ Laravel facade), anthropic-ai/sdk, mozex/anthropic-php,
  google-gemini-php, aws-sdk-php (S3, Bedrock runtime), twilio/sdk, kreait/firebase-php, google/cloud-firestore,
  sentry, resend-php, posthog-php, sendgrid, mailgun, jolicode/slack-php-api. PHP 8 named arguments reuse the keyword
  argument support of the engine.
- **Out of scope by default:** `vendor/`, `tests/`, `*Test.php`, `storage/`, `bootstrap/cache/`, `*.blade.php`.
- **Coverage:** `composer.json` `require`, namespaces per Packagist package (`namespaces.json`), `ecosystem: "composer"`.

## Adding a language

1. Add the tree-sitter grammar as a dev dependency and to `GRAMMARS` in `tsup.config.ts` (only its `.wasm` ships).
2. Create `src/lang/<language>/`: the lowering into `src/lang/ir/model.ts`, `clients.json`, `registry/*.json`,
   manifests, and an `IrLanguage` in `index.ts`; register `irLanguage(...)` in `src/lang/index.ts`.
3. Add the language id to `LanguageSchema` (and its extensions to `src/language.ts`), its HTTP clients to
   `ClientSchema` in `src/report/schema.ts` and its ecosystem to `EcosystemSchema` in `src/report/schema-scan.ts`; bump
   the minor of `SCHEMA_VERSION` and run `pnpm gen:schema`.
4. List the ecosystem's packages per provider in `src/normalize/providers.json` and add a column to
   `scripts/support-table.ts`; run `pnpm gen:support`.
5. Add fixtures under `tests/fixtures/<language>/` (with `expected.json` for regression patterns), a test file like
   `tests/python.test.ts`, and unit tests for the lowering and manifests.

A language whose needs go beyond the IR (a type system the engine should use, like Java or C#) can implement
`Language` directly, as TypeScript does.

| next candidates | ecosystem | notes |
|---|---|---|
| Go | Go modules (`go.mod`) | `net/http`, `resty`; SDK clients are structs (`stripe.Key`, `client.Customers.New(params)`) |
| Ruby | RubyGems (`Gemfile`) | `Net::HTTP`, `Faraday`, `HTTParty`; SDKs are mostly module-level (`Stripe::Customer.create`) |
| Java / Kotlin | Maven / Gradle | `HttpClient`, OkHttp, Retrofit annotations; builders everywhere |
| C# | NuGet | `HttpClient`, RestSharp, typed SDK clients |
