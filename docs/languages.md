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
| Kotlin | supported: HTTP clients and Retrofit interfaces (SDK registries #33 next) | tree-sitter + shared engine | Maven | `build.gradle.kts`, `build.gradle`, `gradle/libs.versions.toml`, `pom.xml` |

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
| `steps.ts`, `fluent.ts` | fluent builders read from step tables (`Request.Builder().url(u).post(b)`, also through variables, fields and factories) and values built entry by entry (`JSONObject().put(k, v)`, `FormBody.Builder().add(k, v)`, `HttpHeaders().set(k, v)`) |
| `pairs.ts` | headers and query parameters set one at a time (builder steps, interceptors, annotated parameters), and those the client adds (`clientParts`) |
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

A language can also give `declarations` (requests an annotated declaration describes, located at the declaration:
Feign, Retrofit), `instanceOf` (calls that return an instance of a project class they name, `retrofit.create(Api::class.java)`:
the methods called on it are the interface's, so their callers' arguments are known), `fluentMaps` (constructors and methods that build a map, a list or a body entry by entry) and
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

**Status:** parsed, lowered and resolved; the HTTP clients and Retrofit service interfaces below are detected. The
JVM SDK registries (#33) come next. Java is #43.

**Detected** (`src/lang/jvm/http/`, tables in `clients.json`):

- **OkHttp** (`okhttp`): `newCall(request)` with a `Request.Builder` chain (also a bare `Builder()` when the client
  is OkHttp's; `url`, verbs, `method`, `header` /
  `addHeader`, `headers`), also built over several statements, held in a field, sent through a wrapper or returned
  by a request factory of the project (`newCall(get(url))`: the factory's parameters read as the call's arguments,
  a factory calling its own name read as its overload);
  `HttpUrl` builders (`toHttpUrl().newBuilder()`, `HttpUrl.Builder()`: path segments and query parameters); bodies
  from `toRequestBody(mediaType)`, `RequestBody.create` (either argument order), `FormBody.Builder` (form) and
  `MultipartBody.Builder` (multipart), also when a project method returns them, the encoding from the media type; a
  `RequestBody` class of the project writes its own bytes, so its body is opaque (`raw`, not its constructor fields).
- **Interceptors**: the headers and query parameters an interceptor sets (a lambda, `Interceptor { }`, an
  `object : Interceptor`, or a project class with its constructor arguments) apply to every call of the client built
  with it (`addInterceptor`, `addNetworkInterceptor`, kept through `newBuilder()`, variables, fields, `by lazy` and
  factories). They are in `query` / `headers` and `authScheme` like any other, and listed in `clientParts` with
  `from: "interceptor"`. `okHttpClientFacts(client, ctx)` (`okhttp.ts`) gives them for any client expression:
  Retrofit reads the client of `.client(okHttp)` with it.
- **`java.net.http`** (`java-http`): `send` / `sendAsync` of an `HttpRequest.newBuilder(uri)` chain (`uri`, `GET`,
  `POST`, `PUT`, `DELETE`, `method`, `header`, `headers(k, v, ...)`, `BodyPublishers.ofString`); `HttpURLConnection`
  (`URL(u).openConnection()`, reported there, with `requestMethod` / `setRequestMethod`, `setRequestProperty`,
  `doOutput` and what the function writes to the output stream; a URL that is not http(s) or an env var, with no HTTP
  setting, is not a request).
- **Ktor client** (`ktor`): verbs and `request` on an `io.ktor.client.HttpClient` (the URL positional or
  `urlString = ...`), with the builder lambda
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
- **Retrofit** (`retrofit`, `retrofit.ts`, `retrofit-link.ts`): one call per annotated method of a service interface,
  at the method declaration: `@GET` ... `@OPTIONS` and `@HTTP(method, path, hasBody)`, `@Path` (the `{name}` stays a
  placeholder), `@Query`, `@QueryMap`, `@Header`, `@HeaderMap`, `@Headers("Name: value")` (literal values in
  `headerValues`), `@Body` (its declared type gives the shape, under `@SerializedName` / `@Json` / `@SerialName` /
  `@JsonProperty` names), `@FormUrlEncoded` with `@Field` / `@FieldMap` (a form body), `@Multipart` with `@Part` /
  `@PartMap`, `@Url` (the URL is the argument). The base URL is the `baseUrl(...)` of the `Retrofit.Builder()` whose
  `create(Api::class.java)` or `create<Api>()` made the interface, followed through variables, fields, `by lazy`,
  factories and singletons set in their getter; an interface created by several builders gives one call per base URL.
  The endpoint is resolved against it by RFC 3986, as Retrofit does (`src/resolve/url-reference.ts`): a relative path
  appends to the base's directory, a leading `/` replaces its path, `.` is the base itself, and a query string in the
  base URL (`baseUrl("https://host/?key=...")`) is dropped, so it is not in `query`. The interceptors of the builder's
  `.client(okHttp)` apply (`clientParts`). The converters (`addConverterFactory`) choose `bodyEncoding`: JSON for
  Gson, Moshi, Jackson and kotlinx.serialization, `raw` for a `String` or primitive body through the scalars converter,
  a `RequestBody`, protobuf, Wire or XML. Values come from the callers of the interface's methods (#39). A file must
  import `retrofit2.http` (or the interface be created on a Retrofit builder): JAX-RS resources use the same
  annotation names.
- **Bodies**: `JSONObject().put(...)` chains (also `val o = JSONObject(); o.put(...)`), `JSONArray`, Gson
  `JsonObject`, Jackson `createObjectNode()`, `mapOf(...)` serialized by Gson, Moshi, Jackson or kotlinx, data
  classes, `LinkedMultiValueMap` (form); `HttpHeaders` and OkHttp `Headers.Builder` as header maps.

**Java reuse.** The detectors read the engine's model only (calls, chains, annotations), and the tables are in
`src/lang/jvm/http/clients.json`, so the Java front end (#43) gets the same clients by lowering Java into the same
model (`new Request.Builder()` is a call of `Request.Builder`, `X.class` a class reference). Retrofit only needs the
annotations of interface methods and parameters and `create(X.class)` linked by `instanceOf`.

**Lowering** (`src/lang/kotlin/`): the module is the file's package, and every file of a package sees the others'
top-level declarations (`packageScope`); `import a.b.*` makes a project package's declarations names of the file, and
`import a.Config.BASE` reads an `object` member. A class's primary constructor, property initializers and `init` blocks
are its `<init>` method; constructor `val` / `var` parameters, body properties, `by lazy { ... }` (what the lambda
returns), getters, nested classes and `companion object` members (initialized in `<clinit>`) are its fields. A bare
name in a method is a local or parameter first, then a member of the class (`this.name`, Kotlin's implicit receiver),
then a top-level name. Lambdas are closures; `x.let { it }` gives `it` the value of `x`, and `run`, `with`,
`withContext` and `lazy` stand for what their lambda returns; `x ?: return` (also `continue`, `break`, `throw`) is
`x`. Annotations of functions and parameters
(`@GET("users/{id}")`, `@Query("page")`) are kept on `FunctionDef.annotations` / `Param.annotations` for Retrofit,
the type arguments of a call (`create<Api>()`) on `CallExpr.typeArgs`,
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
  unresolved, except the client classes listed in `wildcardTypes` of `clients.json` (`HttpClient` under
  `import io.ktor.client.*`, `OkHttpClient` under `import okhttp3.*`) when a single star import of the file has it.
  Retrofit annotations are matched by name in a file that imports `retrofit2.http`.
- Retrofit: an interface created on an injected `Retrofit` (a Hilt `@Provides` parameter), or never created in the
  project, gets the project's only `Retrofit.Builder()` when there is one, else an unknown host (`{baseUrl}`); the
  builder of a DI provider and its injected OkHttp client are #46. `@QueryName` (a parameter name without a value)
  and `@Tag` are not listed, and the keys of a `@QueryMap` / `@HeaderMap` map are only known when the map is.
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
  and `getBalance` sent from one place are two calls with two ids. Calls with no operation keep their ids, also the
  `#n` index of a request a wrapper sends beside a JSON-RPC one (`onePerRequest` in `src/scan.ts` counts every request
  from the place for them, a batch once).
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
- **Where it is read.** `assembleCalls` (`src/assemble.ts`) asks each protocol of `src/operation/index.ts`, one module
  per protocol, for the operations of the resolved request (method, URL, body shape, headers, query), so every
  language gets them from what it already resolves; a front end that knows better sets `ResolvedCall.operation`
  itself and is kept as it is. SDK calls are left out: their registry names the endpoint.

| protocol | issue | status |
|---|---|---|
| JSON-RPC (body `method`) | #34 | done: envelope, batch, helpers, branches, computed names (TypeScript, JavaScript, Python, PHP; Kotlin once its HTTP clients land, #32) |
| GraphQL (document: type, name, fields) | #35 | not started |
| SOAP (`SOAPAction`, `soap:Body`), action-style (`Action=`, `method=`) | #36 | not started |

### JSON-RPC (#34)

`src/operation/json-rpc.ts` reads the body shape every front end already builds, where a literal `method` is a
one-value enum:

- **A request** is a JSON body object with a `jsonrpc` member and a `method`, or, JSON-RPC 1.0 style (older node
  clients), a string `method` together with `params` and `id`. A 1.0-style body whose `method` is an HTTP verb
  (`{ method: "GET", params, id }`, a request handed to a proxy) is not one, nor is a `method` with neither
  (`{ method: "card", amount }`). `from` is `body`.
- **The name** is the `method`'s literal value. Several values (a branch, a variable set on each path, or a helper's
  parameter with the methods its callers pass) give `alternatives`; a value the scan cannot read sets `dynamic` and
  keeps the names it could read. A computed method keeps its literal parts: `` `get${kind}Info` ``, `"eth_" + kind`
  and `"get{$kind}Info"` give `get{kind}Info` / `eth_{kind}` with `dynamic: true` (the body shape itself stays a plain
  `string`; the text is kept beside it by `src/resolve/string-template.ts`).
- **A batch** is a JSON array body: one call per distinct method among its request elements, each with `batch: true`.
- **Helpers** that build the envelope (`rpc(method, params)`) need nothing of their own: wrapper expansion carries
  each caller's literal `method` into the body, so `rpc("getBalance", [address])` is a call at the caller with the
  operation `getBalance`; the request inside the helper lists every method its callers pass as `alternatives`.
- `params` keeps its shape as before: positional `params` an array, named `params` an object with its properties.
- **Not covered**: RPC client libraries that hide the envelope (`@solana/web3.js`, viem, ethers, web3.py,
  solana-py) map a client method to an RPC method and need registries of their own (#52); JSON builders that are not
  literals (`JSONObject().put("method", ...)`) wait for Kotlin's HTTP clients (#32).

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
| #3 Supabase, Firebase, Sentry registries; no-crash scans | done | supabase-py (tables, rpc, auth, storage, functions), firebase-admin (Firestore references, Auth, FCM), sentry-sdk (`capture_*`, not `init`); per-file parse / internal errors | kreait/firebase-php (typed services too), google/cloud-firestore, sentry/sentry (+ Laravel, Symfony); no official Supabase SDK | supabase-kt, Firebase and Sentry artifacts listed in `providers.json` (registries: #33); per-file parse / internal errors |
| #4 diagnostics | done | parse errors, internal errors, dropped calls, `injected-client`, `injected-fetch`, `wrapper-depth`, per-language file counts | same | same; a typed parameter that names no client is not an `injected-client` |
| #5 regression fixtures and recall | done; `tests/fixtures/{javascript,html}/**/expected.json` too | `tests/fixtures/python/**/expected.json` are part of the recall check | `tests/fixtures/php/**/expected.json`, same check | `tests/fixtures/kotlin/**/expected.json`: OkHttp (interceptors too), `java.net.http`, Ktor, Spring, Feign, Retrofit, negatives (server endpoints, JAX-RS resources, gRPC) |
| #6 provider roadmap | done | registries for every P1 / P2 provider with a Python SDK; `providers.json` lists PyPI packages per provider | the same for Packagist | Maven artifacts per provider in `providers.json`; registries with #33 |
| #7 SDK coverage | done | PyPI manifests, import names (`modules.json`), `ecosystem: "pypi"` | `composer.json`, namespaces per package (`namespaces.json`), `ecosystem: "composer"` | Gradle (Kotlin and Groovy DSL, version catalog) and `pom.xml`, package roots (`src/lang/jvm/packages.json`), `ecosystem: "maven"` |
| #8 provider resolution | done | env defaults, env var names, URL helpers, class base URLs; no template in `provider` | `env('X', 'default')`, `getenv() ?: '...'`, Laravel `config()` files, class constants, helpers, `$this->baseUrl` | `System.getenv("X") ?: "..."`, `System.getProperty`, `BuildConfig.X` with its Gradle literal, Spring `@Value("${x:default}")`, constants, `object` and companion members |
| #30 operation outside the URL | `operation` field and its name in `id`; JSON-RPC (#34) from the body shape, GraphQL and SOAP not yet (#35, #36) | same | same | same engine; no JSON-RPC fixture until the HTTP clients (#32) |
| #37 SDK client as an untyped parameter | callers, manifests, `receiver-unknown`, `clientFrom`; not constructor parameters stored on `this` | callers (constructors too), manifests, `receiver-unknown`, `clientFrom` | same as Python | does not apply (parameters are typed) |
| #39 a parameter's values | initializers and callers through checker references | defaults and callers through the IR | same | same engine (Kotlin parameter defaults are lowered); Retrofit interface methods get their callers' arguments and defaults (`tests/fixtures/kotlin/retrofit/`, the Android fixture) |

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
