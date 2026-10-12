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
| Kotlin | supported: HTTP clients (Retrofit #31 and SDK registries #33 next) | tree-sitter + shared engine | Maven | `build.gradle.kts`, `build.gradle`, `gradle/libs.versions.toml`, `pom.xml` |

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
| `sdk.ts` | SDK registry matching on chains (instances, builders, module-level APIs) |
| `http.ts` | table-driven HTTP clients (functions, client objects, fluent modifiers) |
| `steps.ts`, `fluent.ts` | fluent builders read from step tables (`Request.Builder().url(u).post(b)`, also through variables, fields and factories) and values built entry by entry (`JSONObject().put(k, v)`, `FormBody.Builder().add(k, v)`, `HttpHeaders().set(k, v)`) |
| `pairs.ts` | headers and query parameters set one at a time (builder steps, interceptors, annotated parameters), and those the client adds (`clientParts`) |
| `detect.ts`, `wrappers.ts` | detection per function, wrapper expansion up to four deep, `injected-client` / `injected-fetch` / `wrapper-depth` diagnostics |
| `build.ts`, `scan.ts` | report `Call`s, the scan driver (per-file errors are diagnostics, never fatal) and SDK coverage |

A tree-sitter language is then mostly data plus a lowering (`src/lang/python/`, `src/lang/php/`):

- `lower*.ts`: syntax tree to the IR, including the language's environment reads and string formatting;
- `clients.json`: HTTP clients, as tables (functions, client constructors, keyword / option names and what they carry);
- `registry/*.json`: SDK registries;
- `manifests.ts` and `modules.json`: declared packages, their versions, and import names that differ from the package;
- `index.ts`: the `IrLanguage` (excludes, passthrough calls, serializers, custom detectors such as `urllib.request`
  or curl handles, and `resolveCall` for calls that stand for project data, like Laravel's `config()`).

A language can also give `declarations` (requests an annotated declaration describes, located at the declaration:
Feign, then Retrofit), `fluentMaps` (constructors and methods that build a map, a list or a body entry by entry) and
`constants` (library constants with a known value, `MediaType.APPLICATION_JSON`). The engine builds `scoped`
expressions (an expression read in another function's scope) when it puts a request together from pieces written in
several places.

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
  named like the placeholder.

The Python and PHP Stripe registries are derived from the TypeScript one (itself generated from Stripe's OpenAPI spec)
by `pnpm gen:stripe-ports`. The other registries were written against each SDK's own request code; their notes
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

**Out of scope by default:** `vendor/`, `tests/`, `Tests/`, `test/`, `*Test.php`, `storage/`, `bootstrap/cache/`,
`var/cache/`, `*.blade.php`.

**Limitations:**

- Untyped properties and parameters used as clients (`$this->client->post(...)` with an untyped `$client`) are listed
  as `injected-client`.
- Saloon connectors, Laravel `Mail` / `Storage` / notification drivers, AWS command objects (`getCommand`, `execute`),
  `$sdk->createClient('s3')` and PostHog's `init()` host are not followed; SDK coverage shows such packages.
- Laravel facades are matched by their class (`Illuminate\Support\Facades\Http`, or `Http` without a namespace);
  a facade alias registered under another name is not.

## Kotlin

**Status:** parsed, lowered and resolved; the HTTP clients below are detected. Retrofit service interfaces (#31) and
the JVM SDK registries (#33) come next. Java is #43.

**Detected** (`src/lang/jvm/http/`, tables in `clients.json`):

- **OkHttp** (`okhttp`): `newCall(request)` with a `Request.Builder` chain (`url`, verbs, `method`, `header` /
  `addHeader`, `headers`), also built over several statements, held in a field or sent through a wrapper;
  `HttpUrl` builders (`toHttpUrl().newBuilder()`, `HttpUrl.Builder()`: path segments and query parameters); bodies
  from `toRequestBody(mediaType)`, `RequestBody.create` (either argument order), `FormBody.Builder` (form) and
  `MultipartBody.Builder` (multipart), the encoding from the media type.
- **Interceptors**: the headers and query parameters an interceptor sets (a lambda, `Interceptor { }`, an
  `object : Interceptor`, or a project class with its constructor arguments) apply to every call of the client built
  with it (`addInterceptor`, `addNetworkInterceptor`, kept through `newBuilder()`, variables, fields, `by lazy` and
  factories). They are in `query` / `headers` and `authScheme` like any other, and listed in `clientParts` with
  `from: "interceptor"`. `okHttpClientFacts(client, ctx)` (`okhttp.ts`) gives them for any client expression: a
  Retrofit front end reads the client of `.client(okHttp)` with it.
- **`java.net.http`** (`java-http`): `send` / `sendAsync` of an `HttpRequest.newBuilder(uri)` chain (`uri`, `GET`,
  `POST`, `PUT`, `DELETE`, `method`, `header`, `headers(k, v, ...)`, `BodyPublishers.ofString`); `HttpURLConnection`
  (`URL(u).openConnection()`, reported there, with `requestMethod` / `setRequestMethod`, `setRequestProperty`,
  `doOutput` and what the function writes to the output stream; a URL that is not http(s) or an env var, with no HTTP
  setting, is not a request).
- **Ktor client** (`ktor`): verbs and `request` on an `io.ktor.client.HttpClient`, with the builder lambda
  (`parameter`, `header`, `headers { append }`, `setBody`, `contentType`, `bearerAuth`, `basicAuth`, `url("...")`,
  `url { host = ...; path(...); parameters.append(...) }`, `method = HttpMethod.X`), and the client's
  `defaultRequest { url(...); header(...) }` as base URL and `clientParts` with `from: "default"`.
- **Spring** (`spring-rest`, `spring-webclient`): `RestTemplate` as a client table (`getForObject`, `getForEntity`,
  `postForObject`, `put`, `patchForObject`, `delete`, `exchange` with `HttpMethod.X` and an `HttpEntity` of body and
  `HttpHeaders`; `RestTemplateBuilder().rootUri(...)`), URLs from `UriComponentsBuilder`; `RestClient`
  (`spring-rest`) and `WebClient` (`spring-webclient`) chains ended by `retrieve` / `exchange*`, with the `baseUrl`
  and `defaultHeader` of `create(...)` / `builder()`, `uri(...)` (also a `UriBuilder` lambda), `header`,
  `headers { it.setBearerAuth(...) }`, `contentType`, `bodyValue` / `body`.
- **OpenFeign** (`feign`): one call per mapped method of a `@FeignClient` interface, at the method declaration:
  `@GetMapping` ... `@RequestMapping(method = ...)`, the `url` (a `${property:default}` reads as the property with its
  default) and `path` of the annotation, `@RequestParam`, `@RequestHeader`, `@RequestBody` (or an unannotated
  parameter of a method that sends a body), `@SpringQueryMap`; Feign's own `@RequestLine("GET /x")`, `@Headers` and
  `@Param`, with the URL of `Feign.builder().target(X::class.java, url)`.
- **Bodies**: `JSONObject().put(...)` chains (also `val o = JSONObject(); o.put(...)`), `JSONArray`, Gson
  `JsonObject`, Jackson `createObjectNode()`, `mapOf(...)` serialized by Gson, Moshi, Jackson or kotlinx, data
  classes, `LinkedMultiValueMap` (form); `HttpHeaders` and OkHttp `Headers.Builder` as header maps.

**Java reuse.** The detectors read the engine's model only (calls, chains, annotations), and the tables are in
`src/lang/jvm/http/clients.json`, so the Java front end (#43) gets the same clients by lowering Java into the same
model (`new Request.Builder()` is a call of `Request.Builder`, `X.class` a class reference).

**Lowering** (`src/lang/kotlin/`): the module is the file's package, and every file of a package sees the others'
top-level declarations (`packageScope`); `import a.b.*` makes a project package's declarations names of the file, and
`import a.Config.BASE` reads an `object` member. A class's primary constructor, property initializers and `init` blocks
are its `<init>` method; constructor `val` / `var` parameters, body properties, `by lazy { ... }` (what the lambda
returns), getters, nested classes and `companion object` members (initialized in `<clinit>`) are its fields. A bare
name in a method is a local or parameter first, then a member of the class (`this.name`, Kotlin's implicit receiver),
then a top-level name. Lambdas are closures; `x.let { it }` gives `it` the value of `x`, and `run`, `with`,
`withContext` and `lazy` stand for what their lambda returns. Annotations of functions and parameters
(`@GET("users/{id}")`, `@Query("page")`) are kept on `FunctionDef.annotations` / `Param.annotations` for Retrofit,
those of a class (`@FeignClient(...)`) on `ClassDef.classAnnotations`. A property set on a local object
(`conn.requestMethod = "POST"`) is an assignment to `conn.requestMethod`, and an anonymous object with a single
function (`object : Interceptor { override fun intercept(...) }`) stands for that function, like a lambda.

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

- Clients injected by a DI framework (Hilt `@Provides`, Spring beans) are known by their type only: their
  interceptors, default headers and base URL are not followed.
- Ktor `submitForm(formParameters = ...)`, `buildJsonObject { }` bodies, `RequestEntity` builders, WebClient
  `defaultHeaders { }` lambdas, RestTemplate interceptors and builder steps inside `apply { }` are not read (#46, with
  DI-provided clients).
- A member inherited from a base class is only read through `this.x`; a bare `x` resolves to the class's own members.
- Methods of an anonymous `object : Callback { ... }` run as closures of the enclosing code (calls in them are found,
  `this` is the enclosing class's); the anonymous object's own properties are not fields.
- A star import of an external package (`import retrofit2.http.*`) does not tell which names it provides: they stay
  unresolved.
- `BuildConfig` values from `local.properties` or a computed `buildConfigField` have no default; build types and
  flavors other than the first literal are not listed.

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

## How the open issues apply to each language

| issue | TypeScript / JavaScript / HTML | Python | PHP | Kotlin |
|---|---|---|---|---|
| #3 Supabase, Firebase, Sentry registries; no-crash scans | done | supabase-py (tables, rpc, auth, storage, functions), firebase-admin (Firestore references, Auth, FCM), sentry-sdk (`capture_*`, not `init`); per-file parse / internal errors | kreait/firebase-php (typed services too), google/cloud-firestore, sentry/sentry (+ Laravel, Symfony); no official Supabase SDK | supabase-kt, Firebase and Sentry artifacts listed in `providers.json` (registries: #33); per-file parse / internal errors |
| #4 diagnostics | done | parse errors, internal errors, dropped calls, `injected-client`, `injected-fetch`, `wrapper-depth`, per-language file counts | same | same; a typed parameter that names no client is not an `injected-client` |
| #5 regression fixtures and recall | done; `tests/fixtures/{javascript,html}/**/expected.json` too | `tests/fixtures/python/**/expected.json` are part of the recall check | `tests/fixtures/php/**/expected.json`, same check | `tests/fixtures/kotlin/**/expected.json`: OkHttp (interceptors too), `java.net.http`, Ktor, Spring, Feign, negatives (server endpoints, gRPC) |
| #6 provider roadmap | done | registries for every P1 / P2 provider with a Python SDK; `providers.json` lists PyPI packages per provider | the same for Packagist | Maven artifacts per provider in `providers.json`; registries with #33 |
| #7 SDK coverage | done | PyPI manifests, import names (`modules.json`), `ecosystem: "pypi"` | `composer.json`, namespaces per package (`namespaces.json`), `ecosystem: "composer"` | Gradle (Kotlin and Groovy DSL, version catalog) and `pom.xml`, package roots (`src/lang/jvm/packages.json`), `ecosystem: "maven"` |
| #8 provider resolution | done | env defaults, env var names, URL helpers, class base URLs; no template in `provider` | `env('X', 'default')`, `getenv() ?: '...'`, Laravel `config()` files, class constants, helpers, `$this->baseUrl` | `System.getenv("X") ?: "..."`, `System.getProperty`, `BuildConfig.X` with its Gradle literal, Spring `@Value("${x:default}")`, constants, `object` and companion members |
| #30 operation outside the URL | `operation` field and its name in `id`; no protocol detected yet (#34 to #36) | same | same | same |

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
