# Languages

`api-grep` started as a TypeScript scanner. This document describes how it reads several languages, what each one
supports, and how to add the next one. The SDKs each language supports are listed in
[`sdk-support.md`](sdk-support.md) (generated).

| language | status | parser | SDK ecosystem | manifests |
|---|---|---|---|---|
| TypeScript | supported | ts-morph (TypeScript type checker) | npm | `package.json` |
| JavaScript | supported | the same type checker (`allowJs`) | npm | `package.json` |
| HTML | supported | inline scripts through the type checker, forms read directly | npm (CDN scripts) | `package.json` |
| Python | supported | tree-sitter + shared engine | PyPI | `requirements*.txt`, `requirements/*.txt`, `pyproject.toml` (PEP 621, Poetry), `Pipfile`, `setup.cfg`, `setup.py` |
| PHP | supported | tree-sitter + shared engine | Packagist (Composer) | `composer.json` (`require`) |
| Kotlin | SDK registries; no HTTP client yet | tree-sitter + shared engine | Maven | `build.gradle.kts`, `build.gradle`, `gradle/libs.versions.toml`, `pom.xml` |

## Goals

- **One report for a whole repository.** A repository often holds a TypeScript front end and a Python or PHP back end.
  `api-grep scan` reads every supported language it finds (or the ones given with `--language`) and writes one report.
- **Say where each call comes from.** Every call carries `location.language`; `stats.byLanguage` counts calls per
  language, `diagnostics.languages` counts files seen and scanned per language, and each `coverage.sdks` row names its
  `ecosystem` (`npm`, `pypi`, `composer`, `maven`), so the same package name in two ecosystems (`openai`) is two rows.
- **Same report, same rules.** A call found in Python is described exactly like one found in TypeScript: the same
  `Call` schema, provider table, example requests, curl output, secret redaction, diagnostics and SDK coverage. Only detection and resolution are language specific.
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
Call[] ──▶ examples ─▶ schema check ─▶ redaction ─▶ JSON / table / curl              (shared)
           stats, diagnostics, SDK coverage per ecosystem                              (shared)
```

- `src/lang/types.ts` defines a `LanguageFrontEnd`: an id, an ecosystem, file extensions and a `scan` that returns `Call`s,
  files seen and scanned, and coverage rows. `src/lang/index.ts` lists the languages; `src/scan.ts` runs each one and
  merges the results.
- `src/assemble.ts` turns what a front end resolved (URL shape, method, body, headers, query, SDK match) into the report
  `Call`: provider, id and the facts `optionsOpaque` and `bodySource` are decided there, the same way for every
  language.
- Language-neutral helpers shared by every front end: `src/resolve/parts.ts`, `url-shape.ts` (URL templates and host
  classification), `header-names.ts`, `shape-utils.ts`, `sdk-template.ts` (registry paths, `inlinePathLiterals`,
  `basePath`, code-given base URLs) and `src/coverage.ts`.

### TypeScript, JavaScript and HTML

The original pipeline (`src/detect`, `src/resolve`, `src/wrappers`) is the front end of the type checker, wrapped by
`src/lang/typescript/`. It reads code through the TypeScript checker, so callees are identified by declaration and
bodies by their declared types. The same front end reads three languages:

- **TypeScript** (`.ts`, `.tsx`, `.mts`, `.cts`).
- **JavaScript** (`.js`, `.jsx`, `.mjs`, `.cjs`) with `allowJs`: the checker follows CommonJS (`require`,
  `module.exports`) and infers types, so the TypeScript detectors apply as they are. jQuery and `XMLHttpRequest`
  detectors serve both languages; globals of script-tag libraries (`axios`, `$`, `supabase`) map to their packages.
  `jsconfig.json` is read like `tsconfig.json`; minified, bundled and vendored files are out of scope.
- **HTML** (`.html`, `.htm`): `src/lang/html/extract.ts` turns a page into one JavaScript text of the same size, its
  inline scripts in place and everything else blank, added to the project under the page's own path, so a call's line
  and column are the page's. Server-side template tags are rewritten to JavaScript of the same length
  (`src/lang/html/templates.ts`). Forms with an action URL become calls directly (`src/lang/html/forms.ts`), and
  `<script src>` URLs from a CDN count as imports of their npm package.

### Tree-sitter languages: the IR engine

Python, PHP and Kotlin are read without a type checker (Kotlin's declared types are kept, not checked), but they share
most of what a scanner needs. Each is parsed with [tree-sitter](https://tree-sitter.github.io) (WebAssembly grammars,
no native build) and **lowered** into a small language-neutral model (`src/lang/ir/model.ts`):

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
| `evaluate.ts`, `format.ts` | string values as static / env / dynamic parts, like the TypeScript evaluator: constants across files, env defaults, `self.base_url` set in the constructor, parameter defaults, URL helpers and lambdas, fields of objects built in the project (`instance.ts`), literal `.replace()` |
| `shape.ts`, `types.ts`, `request.ts` | body, query and header shapes: dict literals and spreads, serializers (`json.dumps`, `urlencode`), declared types (dataclass, TypedDict, pydantic models) |
| `param-values.ts` | what a parameter no wrapper substituted can be: its callers' arguments (one level) and its default, see [#39](#a-parameters-values-39) |
| `edits.ts` | keys a dict gets or loses after it is built (`kwargs["k"] = v`, `.update`, `$params['k'] = $v`): folded into the variable's value where it is read |
| `sdk.ts` | SDK registry matching on chains (instances, builders, module-level APIs) |
| `http.ts` | table-driven HTTP clients (functions, client objects, fluent modifiers) |
| `detect.ts`, `wrappers.ts` | detection per function, wrapper expansion up to four deep, `injected-client` / `injected-fetch` / `wrapper-depth` diagnostics |
| `receiver.ts` | SDK calls on untyped parameters: the clients callers pass, else the one declared SDK, else `receiver-unknown` (#37) |
| `build.ts`, `scan.ts` | report `Call`s, the scan driver (per-file errors are diagnostics, never fatal) and SDK coverage |

A tree-sitter language is then mostly data plus a lowering (`src/lang/python/`, `src/lang/php/`):

- `lower*.ts`: syntax tree to the IR, including the language's environment reads and string formatting;
- `clients.json`: HTTP clients, as tables (functions, client constructors, keyword / option names and what they carry);
- `registry/*.json`: SDK registries;
- `manifests.ts` and `modules.json`: declared packages, their versions, and import names that differ from the package;
- `index.ts`: the `IrLanguage` (excludes, passthrough calls, serializers, custom detectors such as `urllib.request`
  or curl handles, and `resolveCall` for calls that stand for project data, like Laravel's `config()`).

Language traits are flags of the `IrLanguage`: `moduleVarsVisible` (Python globals), `sharedGlobals` (PHP constants
and functions seen from every file), `packageScope` (the files of a Kotlin package see each other's declarations),
`typedParams` (a typed parameter that names no client is not an `injected-client`), `allowHiddenErrors` and `repair`
(see Kotlin below).

### Registries

Tree-sitter languages use the TypeScript registry format (`RegistryEntry` / `MethodSpec`) with a few additions, typed
as `IrRegistryEntry` / `IrMethodSpec` in `src/lang/ir/language.ts`:

- `imports`: dotted import roots (`openai`, `google.genai`, `sentry_sdk`); `package` is the name a manifest declares;
- `instance.names` may be dotted (`firestore.client`), `instance.urlArg` reads `kw:<name>` and alternatives
  (`0|kw:supabase_url`), `instance.select` picks a service out of a shared factory (`boto3.client("s3")`);
- `builders`: call segments that only narrow a request (`collection`, `document`, `with_raw_response`);
- bodies from keyword arguments: `bodyKwargs`, `bodyKw` (`params=` of StripeClient), `queryKwargs`;
- path parameter sources `kw:<name>`, `seg:<segment>:<N>`, `chain:<a>,<b>`; `arg:N` also matches the keyword argument
  named like the placeholder;
- JVM: `imports` are fully qualified classes (`com.anthropic.client.okhttp.AnthropicOkHttpClient`) or packages
  (`com.stripe.model`), `instance.build` names the call that turns a client builder into the client
  (`S3Client.builder().region(r).build()`), a `builders` name ending in `*` matches a prefix (`set*`), and `setters`
  says how parameters given as builders read as dicts (see [Kotlin](#kotlin)).

The Python, PHP and JVM Stripe registries are derived from the TypeScript one (itself generated from Stripe's OpenAPI
spec) by `pnpm gen:stripe-ports`. The other registries were written against each SDK's own request code; their notes
(versions checked, calls that send nothing) are in each file's `$comment` and `generatedFrom`. PHP 8 named arguments
use the keyword-argument fields (`bodyKwargs`, `kw:<name>`), like Python.

## Python

**Detected:** `requests` (functions and `Session`; `requests_hardened` `Manager().send_request`), `httpx` and `httpx2`
(functions, `Client` / `AsyncClient` with `base_url`), `aiohttp` (`ClientSession`, positional or keyword base URL),
`urllib.request` (`urlopen(url, data)`, `urlopen(Request(url, data, headers, method=...))`, `urlretrieve`), `urllib3`
(`PoolManager().request`), and the SDKs in
[`sdk-support.md`](sdk-support.md) (OpenAI and Azure OpenAI, Anthropic and its Bedrock / Vertex clients, Google Gen AI,
Google Generative AI, Supabase, Firebase Admin, Google Cloud Firestore, Sentry, Stripe, boto3 S3 and Bedrock runtime,
Twilio, Slack, Resend, PostHog, Mistral, Groq, Cohere, ElevenLabs, Convex).

**Resolved:** f-strings, `+`, `%`, `.format()`, `"/".join([...])`, `urljoin`, `os.getenv("X", default)`,
`os.environ["X"]` / `.get`, python-decouple `config()` and django-environ `env()`, module constants (also imported from
project modules, relative imports and `src/` layouts), class attributes, `self.x` set in any method (the subclass's own
first when a base class method runs on it), parameter defaults,
`x or "https://..."` defaults, URL helpers (`def api_url(m): return f"..."`, lambdas), local annotations
(`db: Client = ctx.db`), fields of objects built in the project and passed down (`Call(base="https://...")` for a
dataclass, NamedTuple or pydantic model, `self.url` set in `__init__`, `replace(call, ...)`), literal `.replace()` and
`re.sub` (the pattern is never run). Bodies come from dict literals, `**spreads`, `dict(...)`, `json.dumps`, `urlencode`,
`.model_dump()`, and declared dataclass / TypedDict / pydantic types, with the keys added or removed later in the same
function, before the call (see [Keys added after a dict is built](#keys-added-after-a-dict-is-built-38)).

**Out of scope by default:** `tests/`, `test/`, `test_*.py`, `*_test.py`, `conftest.py`, virtualenvs (`.venv`, `venv`,
`site-packages`), caches. Files a scan excludes are still read so imports resolve through them, as in TypeScript.

**Limitations:**

- No type inference beyond annotations: an untyped parameter used as an HTTP client (`def run(session):
  session.post(url)`) is listed in `diagnostics.unfollowed` as `injected-client`. An untyped parameter used as an SDK
  client is followed to its callers ([below](#sdk-clients-passed-as-untyped-parameters-37)).
- SDK methods passed as callbacks (`retry(stripe.Customer.create, email=...)`) are not followed; the SDK shows as
  `imported-no-calls` in coverage.
- `getattr(client, name)(...)`, `**kwargs` forwarded through several layers, and module-level configuration
  (`openai.base_url = ...`) are not followed.
- Some SDK endpoints depend on an argument (`stream=True` switching paths on Bedrock / Vertex, supabase `rpc(get=True)`);
  the registry lists the default form.

## PHP

**Detected:** Guzzle (`new Client(['base_uri' => ...])`, verbs, `*Async`, `request`, `ClientInterface` parameters,
`\Drupal::httpClient()`), the Laravel `Http` facade with its fluent modifiers, Symfony HttpClient (`create`,
`createForBaseUri`, `HttpClientInterface`), curl handles (`curl_init` / `curl_setopt` / `curl_setopt_array`, reported
at `curl_exec`), PSR-7 requests sent through `send` / `sendRequest`, `file_get_contents` / `fopen` on http(s) URLs or
with an http stream context, WordPress `wp_remote_*`, and the SDKs in [`sdk-support.md`](sdk-support.md) (Stripe,
openai-php, Anthropic, Gemini, AWS S3 and Bedrock runtime, Twilio, kreait Firebase, Google Cloud Firestore, Sentry,
Resend, PostHog, SendGrid, Mailgun, jolicode Slack).

**Resolved:** namespaces and `use` (classes, `use function`, `use const`, groups, aliases), fully qualified names,
`self::` / `static::` / `parent::` (`static::` and `$this` bind late, to the subclass a base method runs on), class
constants and static properties, `define()` and `const` (visible from every
file), promoted constructor properties, typed properties and parameters, `$this->x` set in any method, closures and
arrow functions, `.` and `.=`, `??`, `?:`, `sprintf`, `str_replace` / `preg_replace` (the pattern is never run),
fields of objects built in the project (`new Call(base: '...')`, promoted or set in the constructor), named
arguments, double-quoted, heredoc and nowdoc strings, `env('X', 'default')`,
`getenv()`, `$_ENV`, `$_SERVER`, and Laravel `config('file.key')` / `Config::get(...)` read from `config/<file>.php`.
Arrays keep the keys set later in the function (`$params['k'] = $v`, `$params += [...]`, `array_merge(...)`,
`unset(...)`, see [#38](#keys-added-after-a-dict-is-built-38)).

**Out of scope by default:** `vendor/`, `tests/`, `Tests/`, `test/`, `*Test.php`, `storage/`, `bootstrap/cache/`,
`var/cache/`, `*.blade.php`.

**Limitations:**

- Untyped properties and parameters used as HTTP clients (`$this->client->post(...)` with an untyped `$client`) are
  listed as `injected-client`. SDK clients passed as untyped parameters (`function ask($client, $prompt)`) are followed
  as in Python ([below](#sdk-clients-passed-as-untyped-parameters-37)).
- Saloon connectors, Laravel `Mail` / `Storage` / notification drivers, AWS command objects (`getCommand`, `execute`),
  `$sdk->createClient('s3')` and PostHog's `init()` host are not followed; SDK coverage shows such packages.
- Laravel facades are matched by their class (`Illuminate\Support\Facades\Http`, or `Http` without a namespace);
  a facade alias registered under another name is not.

## Kotlin

**Status:** parsed, lowered and resolved; SDK calls are detected through the JVM registries (#33). No HTTP client
table yet: Retrofit service interfaces (#31) and OkHttp, `java.net.http`, Ktor, Spring and Feign (#32) build on this.
Java is #43; it will read the same registries.

**Detected:** the SDKs in [`sdk-support.md`](sdk-support.md): OpenAI and Anthropic (the official Java SDKs), Stripe,
AWS SDK for Java 2.x S3 and Bedrock Runtime, Google Gen AI, Firestore (google-cloud-firestore, firebase-admin's
`FirestoreClient`, the Android SDK), Firebase Admin Auth, Cloud Messaging and Realtime Database, Twilio, Slack, Sentry
and PostHog (the Android / JVM facade and posthog-java). The registries are in `src/lang/jvm/registry/`, keyed by Maven
coordinates and fully qualified classes so that Java reuses them as they are.

**SDK registries** (#33): JVM SDKs build clients with factories and builders, reach resources through accessor calls,
and take parameters as builders.

- **Clients:** `AnthropicOkHttpClient.fromEnv()`, `OpenAIOkHttpClient.builder().apiKey(k).baseUrl(u).build()`
  (`instance.build`; `baseUrl` / `endpointOverride` / `host` give the base URL through `instance.urlArg`),
  `StripeClient(key)`, `S3Client.create()`, `Slack.getInstance().methods(token)`, a declared type (`client:
  AnthropicClient`), static configuration that sends nothing (`Stripe.apiKey = ...`, `Twilio.init(...)`).
- **Methods:** accessor chains (`client.chat().completions().create(params)`, `client.models.generateContent(...)` with
  `models` a field), static resource methods (`Customer.create(params)`, `Message.creator(...).create()`), operations
  on a retrieved object (`Customer.retrieve(id).update(params)`), Firestore references (`collection(...)`,
  `document(...)` and query calls narrow the request). `async()` and `withRawResponse()` are left out of method keys.
- **Builders as bodies** (`src/lang/ir/builders.ts`, the language's `resolveCall`): `X.builder() ... .build()` on a
  class of an SDK's parameter packages (`setters.packages`) reads as the dict of the fields its setters set, so shapes,
  path parameters (`pathFromBody`: S3's `Bucket` and `Key`, Bedrock's `modelId`) and the model read it like a dict
  literal. A builder kept in a variable collects the setters called on it before `.build()` in the same function;
  nested builders (`addLineItem(LineItem.builder()...build())`) are nested objects; a lambda that fills the request
  (`s3.getObject { it.bucket(b).key(k) }`, `chatPostMessage { it.channel(c) }`) reads the same way. Field names
  follow each SDK's rule (`setters.case`): `maxTokens` -> `max_tokens` (OpenAI, Anthropic, Slack), `setEmail` ->
  `email` (Stripe), `bucket` -> `Bucket` (S3), as written (Bedrock, FCM); `addTool` appends to `tools`, `putMetadata(k,
  v)` sets `metadata.k`, `addUserMessage(text)` adds `{role: "user", content: text}` to `messages` (`setters.fields`).
- **Models:** an enum constant of the SDK (`Model.CLAUDE_SONNET_4_5`, `ChatModel.GPT_4_1_MINI`) is the model id it
  stands for (`claude-sonnet-4-5`, `gpt-4.1-mini`: `setters.constants` and `constantRewrites`); other enum constants
  are their snake_case value (`SessionCreateParams.Mode.SUBSCRIPTION` -> `subscription`). String overloads
  (`.model("gpt-4o")`) and models in the path (`generateContent("gemini-2.0-flash", ...)`) are read as in Python.
- **Coverage:** a declared and imported JVM SDK with a registry and no call found is `imported-no-calls`. An import
  that matches the package roots of several artifacts counts for a declared one first (firebase-admin's
  `com.google.firebase.auth` is not the Android `firebase-auth`'s when only firebase-admin is declared).

**Lowering** (`src/lang/kotlin/`): the module is the file's package, and every file of a package sees the others'
top-level declarations (`packageScope`); `import a.b.*` makes a project package's declarations names of the file, and
`import a.Config.BASE` reads an `object` member. A class's primary constructor, property initializers and `init` blocks
are its `<init>` method; constructor `val` / `var` parameters, body properties, `by lazy { ... }` (what the lambda
returns), getters, nested classes and `companion object` members (initialized in `<clinit>`) are its fields. A bare
name in a method is a local or parameter first, then a member of the class (`this.name`, Kotlin's implicit receiver),
then a top-level name. Lambdas are closures; `x.let { it }` gives `it` the value of `x`, and `run`, `with`,
`withContext` and `lazy` stand for what their lambda returns. Annotations of functions and parameters
(`@GET("users/{id}")`, `@Query("page")`) are kept on `FunctionDef.annotations` / `Param.annotations` for Retrofit.

**Resolved:** string templates (`"$base/v1/${id}"`, raw strings), `+`, `buildString { append(...) }`,
`StringBuilder(...).append(...).toString()`, `String.format` and `"...".format(...)`, `joinToString`, `mapOf("a" to
b)` / `listOf`, `?:`, `if` / `when` / `try` as values, `const val`, parameter defaults and named arguments,
`System.getenv("X")` (also `getenv()["X"]` and `getOrDefault`), `System.getProperty("x", "default")`, Android
`BuildConfig.X` read as the configuration value `X` with the literal of `buildConfigField` in the module's nearest
Gradle build script as its default, and Spring `@Value("\${x:default}")` on properties and constructor parameters.
Declared types of parameters, properties and locals are kept, so a client's type names it (`client: OkHttpClient`);
data classes and other classes with typed constructor properties give body shapes, under their
`@SerializedName`, `@Json(name = ...)`, `@SerialName` or `@JsonProperty` names (`@Transient` / `@JsonIgnore` aside).

**Manifests** (`src/lang/jvm/`, shared with Java later): Gradle build scripts in the Kotlin and Groovy DSL
(`implementation("g:a:v")`, `api 'g:a:v'`, `group:` / `name:` maps, `platform(...)`, `libs.x` and `libs.bundles.x`
from `gradle/libs.versions.toml`; test configurations aside; versions from script variables and `gradle.properties`),
and `pom.xml` (test scope and plugin dependencies aside; `${property}` versions from the pom and its parent
directories' poms, `dependencyManagement` versions). Packages are `group:artifact`; their package roots are the group
id unless `src/lang/jvm/packages.json` says otherwise. Every manifest is read as text with linear-time patterns, never
run.

**Grammar:** `@tree-sitter-grammars/tree-sitter-kotlin` (the unscoped `tree-sitter-kotlin` package ships no `.wasm`).
It wants a separator after the last member of a class body closed on the same line (`companion object { const val X =
1 }`): with one such body it inserts a hidden token (`allowHiddenErrors` accepts the tree), with two it gives up on the
file. A file that does not parse is then read once more with a `;` in place of the space before each such `}`
(`repair`, `src/lang/kotlin/repair.ts`): same length, so every position stays, kept only if it parses.

**Out of scope by default:** `*.gradle.kts`, `buildSrc/`, `build-logic/`, `.gradle/`, test source sets (`src/test*`,
`src/androidTest*`, `src/*Test`), `test/`, `tests/`, `*Test.kt`, `*Tests.kt`.

**Limitations:**

- A member inherited from a base class is only read through `this.x`; a bare `x` resolves to the class's own members.
- Methods of an anonymous `object : Callback { ... }` run as closures of the enclosing code (calls in them are found,
  `this` is the enclosing class's); the anonymous object's own properties are not fields.
- A star import of an external package (`import retrofit2.http.*`) does not tell which names it provides: they stay
  unresolved.
- `BuildConfig` values from `local.properties` or a computed `buildConfigField` have no default; build types and
  flavors other than the first literal are not listed.
- SDK parameters that are Java objects the SDK serializes itself (Gen AI contents, Firebase `UserRecord.CreateRequest`,
  Twilio creator arguments) give no body. A builder filled in `apply { ... }`, or in steps spread over several
  functions, is not read; keys set in a branch are not marked optional. A path id given inside a params object rather
  than as the first argument stays a placeholder. The `PostHogConfig` host given to `PostHog.setup` is not followed.
- AWS artifacts other than S3 and Bedrock Runtime, the AWS SDK for Kotlin and other JVM SDKs listed in `providers.json`
  are reported as `unsupported` in `coverage.sdks` (#49, #50).

## JavaScript and HTML

**Detected:** everything the TypeScript front end detects (fetch, axios, got, ky, node http, SDK registries, the AI
SDK, framework helpers), plus jQuery (`$.ajax`, `$.get`, `$.getJSON`, `$.post`) and `XMLHttpRequest`
(`open` + `setRequestHeader` + `send`); in HTML pages, inline scripts and `<form action>` submissions.

**Resolved:** as in TypeScript, plus CommonJS exports (`const { BASE } = require("./config")`,
`config.base` with `module.exports = {...}`), `require("stripe")(key)`, fields assigned in any method
(`this._stripe = new Stripe(key)` in `configure()`), and in HTML, template tags as dynamic values.

**Out of scope by default:** `*.min.js`, `*.bundle.js`, `*.chunk.js`, files with a line over 2,000 characters in their
first 8 KB, `vendor/`, `bower_components/`, `coverage/`, `.nuxt/`, `.output/`, `.svelte-kit/`, test and spec files
(`*.test.ts`, `*.spec.ts`, `*.e2e-spec.ts`, `__tests__/`, `__mocks__/`, `__testfixtures__/`).

**Limitations:** Vue / Svelte single-file components and other template formats are not read; event-handler
attributes (`onclick="..."`) are not; a form whose action is a template tag is skipped (its target is the app's own
route); `{% url %}` / `url_for` values in scripts stay unknown hosts.

## Operations the URL does not name (#30)

JSON-RPC, GraphQL, SOAP and action-style APIs (AWS Query, Flickr) send every operation to one URL and name it in the
body, a header or a query parameter. A call to one of them carries `operation`, the same for every language and
protocol (`Operation` in `src/report/schema.ts`):

```ts
operation?: {
  protocol: "json-rpc" | "graphql" | "soap" | "action";
  /** getTransaction, GetOrder (the root fields of an anonymous GraphQL operation), Track, DescribeInstances */
  name: string | null;
  /** GraphQL only */
  type?: "query" | "mutation" | "subscription";
  /** GraphQL only: selected field paths from the root, aliases resolved, fragments inlined: ["order.id", "order.customer.email"] */
  fields?: string[];
  /** Every name when a branch picks one of several, `name` first */
  alternatives?: string[];
  /** Sent in one request together with other operations (a batch) */
  batch?: boolean;
  /** Part of the name is not known statically: `name` keeps the literal parts with `{…}` for the rest, null if none */
  dynamic: boolean;
  /** Where the request carries the name */
  from: "body" | "header" | "query" | "document";
};
```

- `operationId` keeps its meaning, the OpenAPI operation id from an SDK registry; `operation` is about the wire
  protocol.
- **Identity.** `id` hashes the file, line and column and, when the call has one, `operation.name`: `getTransaction`
  and `getBalance` sent from one place are two calls with two ids. Calls with no operation keep their ids.
- **Batches: one `Call` per operation.** A request that sends several operations together (a JSON-RPC array, a GraphQL
  batch array) gives one `Call` per operation, at the request's location, each with its own `id` and `batch: true`;
  the same operation twice in one batch is one call. Every field but `operation` and `id` describes the HTTP request,
  so it is the same on each operation of a batch (the body is the whole array). A request that sends one operation
  picked by a branch gives one `Call` with `alternatives`. A GraphQL document holding several operations is not a
  batch: the request runs the one `operationName` names.
  - `alternatives` means "one of these"; a batch sends all of them. One field for both would merge two facts.
  - Each operation is an endpoint: grouping by `id`, or by `method`, `pathTemplate` and `operation.name`, needs no
    special case, and "which calls send `getTransaction`" is a filter on `operation.name`.
  - GraphQL operations each have their own `type` and `fields`, which one `Call` could not hold.
  - The cost: `stats.callsFound` counts operations rather than HTTP requests, as it already counts each request a
    wrapper sends from one call site; `batch` and the shared location tell them apart.
  - Not chosen: one `Call` with `alternatives` (merges "one of" and "all of", drops per-operation fields), or an
    `operations` array on `Call` (every reader of the common single-operation case loops over a list, and ids and
    grouping per operation need another key).
- Front ends fill it through `ResolvedCall.operation` (`src/assemble.ts`). No protocol is detected yet:

| protocol | issue | status |
|---|---|---|
| JSON-RPC (body `method`) | #34 | not started |
| GraphQL (document: type, name, fields) | #35 | not started |
| SOAP (`SOAPAction`, `soap:Body`), action-style (`Action=`, `method=`) | #36 | not started |

## SDK clients passed as untyped parameters (#37)

A helper that takes the client as an argument (`def ask(client, prompt): client.messages.create(...)`,
`function withUntyped(c: any, prompt)`, `function ask($client, $prompt)`) has no type that names the SDK. When the
receiver of a call is a parameter with no usable type (none, `any` or `unknown`) and the members after it form a
registry method of two members or more (`messages.create`, `chat.completions.create`), the scan:

1. **Follows the callers**, one level up: every call to the function in the repository (a Python / PHP constructor's
   callers too, for a client stored on `self` / `$this` by `__init__` / `__construct`), with the parameter bound to the
   argument at its position. Callers that pass a known SDK client give the call with that client, one call per distinct
   client (registry entry and base URL given in the code): OpenAI and an OpenAI-compatible client with another
   `base_url` are two calls at the same location, each with its own provider, host and id. `clientFrom: "caller"`.
2. **Falls back to the manifests** when no caller passes a known client (an exported library function, a callback, a
   caller passing its own untyped parameter): if exactly one SDK package the manifests between the file and the scanned
   directory declare has that method, the call uses it (its first registry entry: `Anthropic`, not
   `AnthropicBedrock`). `clientFrom: "manifest"`.
3. **Otherwise** lists the call in `diagnostics.unfollowed` with reason `receiver-unknown` and the callee expression,
   instead of dropping it.

Decisions:

- The call is reported where the SDK method is called, inside the helper; the helper's other parameters take the
  values its callers pass and their defaults there, as any parameter's do (#39). A caller whose other arguments flow into the request also gets the call through wrapper expansion
  (`via: wrapper:ask`), as with a typed parameter; that call needs no `clientFrom` since its client is the caller's own.
- The issue suggested lowering a `confidence` on manifest matches. The report states facts and has no score, so the
  fact is `clientFrom` and the weighing is left to the consumer.
- One member after the parameter (`session.post(url)`) stays an HTTP client verb (`injected-client`): many objects
  have a `get` or a `post`, few have a `chat.completions.create`.
- Bounds: 50 callers per function, 4 distinct clients per call. Callers are only followed one level; a client passed
  through two helpers is found at the outer call site by wrapper expansion and inside the inner helper through the
  manifests.

| language | status |
|---|---|
| Python | callers (functions, methods, constructors), manifests, `receiver-unknown` |
| PHP | same engine, same behaviour (`tests/fixtures/php/receiver/`) |
| TypeScript / JavaScript | callers (functions, arrow functions, methods) in the scanned files, `package.json` manifests, `receiver-unknown`; a client stored on `this` by a constructor parameter is not followed yet |
| Kotlin | does not apply: every parameter has a type, and one that names no client stays unresolved (`typedParams`) |

## Keys added after a dict is built (#38)

Code that adapts one call to several models or API versions often builds the arguments and then completes them:
`kwargs["max_tokens"] = 64` in one branch, `kwargs["max_completion_tokens"] = 64` in the other. For a variable that
becomes a call's arguments or body, the statements of the same function that run before the call change its keys:

| language | adds | removes |
|---|---|---|
| Python | `kwargs["k"] = v`, `kwargs.update(k=v)`, `.update({...})`, `.update(**other)`, `.setdefault("k", v)`, `kwargs \|= {...}`, `kwargs = {**kwargs, ...}` | `del kwargs["k"]`, `kwargs.pop("k")` |
| TypeScript / JavaScript | `params.k = v`, `params["k"] = v`, `Object.assign(params, {...})` | `delete params.k`, `params.k = undefined` |
| PHP | `$params['k'] = $v`, `$params += [...]` (keys not set yet), `$params = array_merge($params, [...])`, `$data['k'] = $v` with no `$data = [...]` before | `unset($params['k'])` |

- **Branches.** Every key set on some path is reported. A key set in a block that may not run (an `if` branch, a loop
  body, a `case`, an `except` / `catch`, the right side of `&&`) is left out of `required`, unless every branch of an
  `if` / `elif` / `else` chain sets it. Values set on several paths merge as alternatives (`model: ["gpt-4o-mini",
  "o3"]`), and literal values count for the `model` fact like those of a dict literal.
- **Order.** Only statements before the call count; a later edit, or one in a nested function or callback, does not. A
  removal in a branch makes the key optional; an unconditional one drops it.
- **Where.** Python and PHP: the front ends lower each statement as an edit of the variable (`Assign.edit` in
  `src/lang/ir/model.ts`, blocks that may not run in `FunctionDef.branches`); `lookup` (`src/lang/ir/project.ts`)
  folds the edits into one dict literal (`src/lang/ir/edits.ts`), so shapes, options, the model and every other reader
  see them. TypeScript: `src/resolve/object-edits.ts` collects the edits of a variable declared with an object, and
  `src/resolve/edited-shape.ts` applies them to its shape (`identifierShape` in `src/resolve/body.ts`).
- **Limits.** Python and PHP edit a value built in place: a dict literal, `dict(...)`, `.copy()`, `**kwargs`. A dict
  returned by a function, or a plain parameter, keeps the keys the code gives it, and a key that comes from a spread
  of another variable cannot be removed. In TypeScript, only `const` / `let` declarations initialized with a value of
  object shape are edited (not `fetch` init objects read key by key, such as `init.headers = ...`).

## A parameter's values (#39)

Wrappers keep their model and version settings in parameter defaults (`model="gpt-4o-mini"`, `max_tokens=1024`,
`api_version="2024-06-01"`). When a body value, a model or a header value is a parameter of the enclosing function that
no wrapper expansion substituted (the call as written in the wrapper's body), it is read from:

- the literals its callers in the project pass, one level up (a caller's own parameter is not followed further);
- its default, when some caller leaves it out or nothing in the project calls the function.

The values merge as alternatives: `model.values` lists them all, a body value becomes an `enum` with every value, and
`dynamic` is true when a caller passes something that cannot be read (that value adds the parameter's declared type or
a dynamic shape next to the literal ones). At a caller, wrapper expansion already substitutes the argument, so each
call site keeps its own single value.

- **Headers.** `headerValues` keeps one value per header: the first, or null when one value cannot be read. A header
  that can take several values also lists every literal one in `headerAlternatives` (schema 1.8.0). Credential headers
  never list values.
- **What counts.** Literal scalars, constants, env var defaults and class attributes (`model or self.default_model`
  merges both); an object or a list a caller builds is read at that caller, not merged into the wrapper's call. `None`
  / `null` / `undefined` stand for "not given" and add no value.
- **Callers.** Python and PHP: calls of the function or method (`self.f(...)`, `$this->f(...)`, a class call for its
  constructor) found among the project's same-named calls (`src/lang/ir/param-values.ts`). TypeScript: the checker's
  references to the function, the variable holding it, or the class it constructs (`src/resolve/param-values.ts`); a
  function also passed as a value (`items.map(fetchOne)`) or called with a spread counts as unread. At most 20 callers
  are read; past that, the rest count as unread.
- **Not covered.** Callers outside the project (an exported library function) are not seen: with no caller in the
  project the default alone is reported. Dataclass and TypeScript class field initializers were already read
  (`self.model`, `this.model`); the values a constructor call gives a dataclass field are not merged with them.

## How the open issues apply to each language

| issue | TypeScript / JavaScript / HTML | Python | PHP | Kotlin |
|---|---|---|---|---|
| #3 Supabase, Firebase, Sentry registries; no-crash scans | done | supabase-py (tables, rpc, auth, storage, functions), firebase-admin (Firestore references, Auth, FCM), sentry-sdk (`capture_*`, not `init`); per-file parse / internal errors | kreait/firebase-php (typed services too), google/cloud-firestore, sentry/sentry (+ Laravel, Symfony); no official Supabase SDK | Firestore (google-cloud-firestore, firebase-admin, Android), firebase-admin Auth, FCM and Realtime Database, sentry-java / sentry-android capture calls (#33); supabase-kt listed in `providers.json` (#50); per-file parse / internal errors |
| #4 diagnostics | done | parse errors, internal errors, dropped calls, `injected-client`, `injected-fetch`, `wrapper-depth`, per-language file counts | same | same; a typed parameter that names no client is not an `injected-client` |
| #5 regression fixtures and recall | done; `tests/fixtures/{javascript,html}/**/expected.json` too | `tests/fixtures/python/**/expected.json` are part of the recall check | `tests/fixtures/php/**/expected.json`, same check | `tests/fixtures/kotlin/**/expected.json`: negatives and the SDK fixtures of #33 (`tests/fixtures/kotlin/sdk/`); HTTP client fixtures with #31 / #32 |
| #6 provider roadmap | done | registries for every P1 / P2 provider with a Python SDK; `providers.json` lists PyPI packages per provider | the same for Packagist | Maven artifacts per provider in `providers.json`; registries for OpenAI, Anthropic, Stripe, AWS S3 and Bedrock Runtime, Gen AI, Firebase, Twilio, Slack, Sentry, PostHog (#33), the rest in #49 / #50 |
| #7 SDK coverage | done | PyPI manifests, import names (`modules.json`), `ecosystem: "pypi"` | `composer.json`, namespaces per package (`namespaces.json`), `ecosystem: "composer"` | Gradle (Kotlin and Groovy DSL, version catalog) and `pom.xml`, package roots (`src/lang/jvm/packages.json`), `ecosystem: "maven"`; a declared artifact's roots win over an undeclared one's |
| #8 provider resolution | done | env defaults, env var names, URL helpers, class base URLs; no template in `provider` | `env('X', 'default')`, `getenv() ?: '...'`, Laravel `config()` files, class constants, helpers, `$this->baseUrl` | `System.getenv("X") ?: "..."`, `System.getProperty`, `BuildConfig.X` with its Gradle literal, Spring `@Value("${x:default}")`, constants, `object` and companion members |
| #30 operation outside the URL | `operation` field and its name in `id`; no protocol detected yet (#34 to #36) | same | same | same |
| #37 SDK client as an untyped parameter | callers, manifests, `receiver-unknown`, `clientFrom`; not constructor parameters stored on `this` | callers (constructors too), manifests, `receiver-unknown`, `clientFrom` | same as Python | does not apply (parameters are typed) |
| #39 a parameter's values | initializers and callers through checker references | defaults and callers through the IR | same | same engine (Kotlin parameter defaults are lowered); SDK wrappers read their callers' values like Python |

## Adding a language

1. Add the tree-sitter grammar as a dev dependency and to `GRAMMARS` in `src/lang/grammars.ts` (only its `.wasm` ships;
   the build copies it next to the bundle).
2. Create `src/lang/<language>/`: the lowering into `src/lang/ir/model.ts`, `clients.json`, `registry/*.json`,
   manifests, and an `IrLanguage` in `index.ts`; register `irLanguage(...)` in `src/lang/index.ts`.
3. Add the language id to `LanguageSchema` (and its extensions to `src/language.ts`), its HTTP clients to
   `ClientSchema` in `src/report/schema.ts` and its ecosystem to `EcosystemSchema` in `src/report/schema-scan.ts`; bump
   the minor of `SCHEMA_VERSION` and run `pnpm gen:schema`.
4. List the ecosystem's packages per provider in `src/normalize/providers.json` and add a column to
   `scripts/support-table.ts`; run `pnpm gen:support`.
5. Add fixtures under `tests/fixtures/<language>/` (with `expected.json` for regression patterns), a test file like
   `tests/python.test.ts` or `tests/php.test.ts`, and unit tests for the lowering and manifests.

A language whose needs go beyond the IR (a type system the engine should use, like Java or C#) can implement
`Language` directly, as TypeScript does.

| next candidates | ecosystem | notes |
|---|---|---|
| Go | Go modules (`go.mod`) | `net/http`, `resty`; SDK clients are structs (`stripe.Key`, `client.Customers.New(params)`) |
| Ruby | RubyGems (`Gemfile`) | `Net::HTTP`, `Faraday`, `HTTParty`; SDKs are mostly module-level (`Stripe::Customer.create`) |
| Java | Maven / Gradle (shared with Kotlin) | one front end with Kotlin for mixed projects (#43); `HttpClient`, OkHttp, Retrofit annotations |
| C# | NuGet | `HttpClient`, RestSharp, typed SDK clients |
