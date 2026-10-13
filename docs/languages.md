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
| Kotlin | supported: HTTP clients, Retrofit interfaces and SDK registries | tree-sitter + shared engine | Maven | `build.gradle.kts`, `build.gradle`, `gradle/libs.versions.toml`, `pom.xml` |
| Java | supported: the same clients and registries, one index with Kotlin | tree-sitter + shared engine (the Kotlin front end) | Maven | the same as Kotlin |

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

A scan does not hold every file in one checker (#68). `src/lang/typescript/graph.ts` first reads each file's imports
(and `require`, `import()`, JSDoc import types, `/// <reference>`), its `declare module` blocks and, for a script, the
global names it declares, and groups the files that can see each other: linked by an import in either direction,
through files in scope or other code the checker loads (never `node_modules`), by an ambient module, or by a global
name. A `declare global` block, or an interface of a script, links its file to every file. Groups are packed into
batches of about 16 MB of source (a repository with less is one project, without the pre-pass) (`batches.ts`), each read by a project of its own and dropped once its calls are built;
calls, diagnostics and coverage come out in the order a single project gives them. A group is never split: when one
group is most of the repository (a backend whose modules import each other), `checker-budget.ts` drops the checker's
types once it has made 400,000 types or 3 million instantiations, and a new checker makes again those it needs. The
trigger is a count, not the heap: a new checker can type a few expressions differently (TypeScript's inference depends
on the order it meets types), and a report must be the same whatever the heap or the machine. Imports are resolved by
`src/module-resolution.ts`, which keeps what it found and not every path it tried (the checker's own keeps them for
watch mode: hundreds of megabytes in a repository scanned without `node_modules`). Union members of a type are
ordered by their text, not by when the checker first met them, and the properties of a mapped type over a union of
keys by name: a shape no longer depends on which other files a checker read. The receiver resolver (#37) counts its 50
callers among the calls of the function's group.

- **TypeScript** (`.ts`, `.tsx`, `.mts`, `.cts`). A `.ts` file that is XML (Qt Linguist translations) or binary (MPEG
  transport streams) is not TypeScript and is left out.
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

Python, PHP, Kotlin and Java are read without a type checker (Kotlin's and Java's declared types are kept, not checked), but they share
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
| `steps.ts`, `fluent-chain.ts`, `fluent.ts` | fluent builders read from step tables (`Request.Builder().url(u).post(b)`, also through variables, fields and factories; `fluentChains` follows each return of a factory and each branch of a conditional) and values built entry by entry (`JSONObject().put(k, v)`, `FormBody.Builder().add(k, v)`, `HttpHeaders().set(k, v)`) |
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
the methods called on it are the interface's, so their callers' arguments are known), `fluentMaps` (constructors and methods that build a map, a list or a body entry by entry),
`constants` (library constants with a known value, `MediaType.APPLICATION_JSON`) and `injection` (what a DI container
gives a parameter or field nothing else sets, and container lookups such as Koin's `get<T>()`: the JVM's, see
[Kotlin](#kotlin); the engine asks it wherever a parameter has no substituted argument, `src/lang/ir/injected.ts`). The engine builds `scoped`
expressions (an expression read in another function's scope) when it puts a request together from pieces written in
several places.

Language traits are flags of the `IrLanguage`: `moduleVarsVisible` (Python globals), `sharedGlobals` (PHP constants
and functions seen from every file), `packageScope` (the files of a Kotlin or Java package see each other's declarations), `alsoReads` (other languages
lowered into the same modules and index: Java with Kotlin, see [Java](#java)),
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

**Status:** parsed, lowered and resolved; the HTTP clients and Retrofit service interfaces below are detected, and SDK
calls through the JVM registries (#33). Java is read by the same front end, into the same index ([Java](#java)).

**SDKs:** the SDKs in [`sdk-support.md`](sdk-support.md): OpenAI and Anthropic (the official Java SDKs), Stripe,
AWS SDK for Java 2.x S3 and Bedrock Runtime, Google Gen AI, Firestore (google-cloud-firestore, firebase-admin's
`FirestoreClient`, the Android SDK), Firebase Admin Auth, Cloud Messaging and Realtime Database, Twilio, Slack, Sentry
and PostHog (the Android / JVM facade and posthog-java). The registries are in `src/lang/jvm/registry/`, keyed by Maven
coordinates and fully qualified classes, so Java reads them as they are.

**SDK registries** (#33): JVM SDKs build clients with factories and builders, reach resources through accessor calls,
and take parameters as builders.

- **Clients:** `AnthropicOkHttpClient.fromEnv()`, `OpenAIOkHttpClient.builder().apiKey(k).baseUrl(u).build()`
  (`instance.build`; `baseUrl` / `endpointOverride` / `host` give the base URL through `instance.urlArg`),
  `StripeClient(key)`, `S3Client.create()`, `Slack.getInstance().methods(token)`, a declared type (`client:
  AnthropicClient`, also before a factory: `slack.methods(token)` with `slack: Slack`), static configuration that
  sends nothing (`Stripe.apiKey = ...`, `Twilio.init(...)`). The Android Firebase SDKs share firebase-admin's class
  names (`FirebaseMessaging`, `FirebaseAuth`, `FirebaseDatabase`): where the manifests declare the Android artifact and
  not firebase-admin, those classes are not firebase-admin's (`sameClassesAs`), so `subscribeToTopic(topic)` in an app
  is not a server call.
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
  firebase-admin's roots are its own packages (`auth`, `cloud`, `database`, `messaging`, `projectmanagement`); the
  root of `com.google.firebase`, shared with Android Firebase (`FirebaseApp`, `analytics`, `crashlytics`,
  `remoteconfig`), counts for it only where the manifests declare it (`declaredOnly` in `src/lang/jvm/packages.json`,
  #62), so an Android app is not reported as importing the server SDK.

**HTTP clients** (`src/lang/jvm/http/`, tables in `clients.json`):

- **OkHttp** (`okhttp`): `newCall(request)` with a `Request.Builder` chain (also a bare `Builder()` when the client
  is OkHttp's; `url`, verbs, `method`, `header` /
  `addHeader`, `headers`), also built over several statements, held in a field, sent through a wrapper or returned
  by a request factory of the project (`newCall(get(url))`, a method of the class or of a named class:
`newCall(buildRequest(url))`; the factory's parameters read as the call's arguments, a factory calling its own name
read as its overload); a copy of a request built in the project (`request.newBuilder().header(...)`) keeps the
original's URL, method and body;
  `HttpUrl` builders (`toHttpUrl().newBuilder()`, `HttpUrl.Builder()`: path segments and query parameters); bodies
  from `toRequestBody(mediaType)`, `RequestBody.create` (either argument order), `FormBody.Builder` (form) and
  `MultipartBody.Builder` (multipart), also when a project method returns them, the encoding from the media type; a
  `RequestBody` class of the project writes its own bytes, so its body is opaque (`raw`, not its constructor fields).
- **Interceptors**: the headers and query parameters an interceptor sets (a lambda, `Interceptor { }`, an
  `object : Interceptor`, or a project class with its constructor arguments) apply to every call of the client built
  with it (`addInterceptor`, `addNetworkInterceptor`, kept through `newBuilder()`, variables, fields, `by lazy` and
  factories). They are in `query` / `headers` and `authScheme` like any other, and listed in `clientParts` with
  `from: "interceptor"`. Headers set on a response (`chain.proceed(...).newBuilder()`, `Response.Builder()`) and
  one-argument reads (`request.header("X")`) are not the request's. A header set in a branch of the interceptor
  (`if (url.contains(...))`) is still listed for every call. `okHttpClientFacts(client, ctx)` (`okhttp.ts`) gives them for any client expression:
  Retrofit reads the client of `.client(okHttp)` with it.
- **`java.net.http`** (`java-http`): `send` / `sendAsync` of an `HttpRequest.newBuilder(uri)` chain (`uri`, `GET`,
  `POST`, `PUT`, `DELETE`, `method`, `header`, `headers(k, v, ...)`, `BodyPublishers.ofString`); `HttpURLConnection`
  (`URL(u).openConnection()`, reported there, with `requestMethod` / `setRequestMethod`, `setRequestProperty`,
  `doOutput` and what the function writes to the output stream, also in project functions the connection is passed
  to, one level (`prepare(conn)`, `send(conn, json)`, #46); a URL that is not http(s) or an env var, with no HTTP
  setting, is not a request).
- **Ktor client** (`ktor`): verbs and `request` on an `io.ktor.client.HttpClient` (the URL positional or
  `urlString = ...`), with the builder lambda
  (`parameter`, `header`, `headers { append }`, `setBody`, `contentType`, `bearerAuth`, `basicAuth`, `url("...")`,
  `url { host = ...; path(...); parameters.append(...) }`, `method = HttpMethod.X`), and the client's
  `defaultRequest { url(...); url.takeFrom(...); header(...) }` as base URL and `clientParts` with `from: "default"`;
  the `Authorization` of `install(Auth) { bearer { loadTokens { BearerTokens(...) } } }` and `basic { ... }` too.
  Bodies (#46): `submitForm(url, formParameters = parameters { append(k, v) })` (form),
  `submitFormWithBinaryData(url, formData { ... })` and `MultiPartFormDataContent(formData { ... })` (multipart),
  `FormDataContent(Parameters.build { ... })` (form), kotlinx `buildJsonObject { put(k, v); putJsonObject(k) { ... } }`
  and `buildJsonArray { add(...) }` (`src/lang/jvm/http/bodies.ts`).
- **Spring** (`spring-rest`, `spring-webclient`): `RestTemplate` as a client table (`getForObject`, `getForEntity`,
  `postForObject`, `put`, `patchForObject`, `delete`, `exchange` with `HttpMethod.X` and an `HttpEntity` of body and
  `HttpHeaders`; `RestTemplateBuilder().rootUri(...)`), URLs from `UriComponentsBuilder`; `RestClient`
  (`spring-rest`) and `WebClient` (`spring-webclient`) chains ended by `retrieve` / `exchange*`, with the `baseUrl`
  and `defaultHeader` of `create(...)` / `builder()`, `uri(...)` (also a `UriBuilder` lambda), `header`,
  `headers { it.setBearerAuth(...) }`, `contentType`, `bodyValue` / `body`. Since #46 (`spring-parts.ts`): the
  builder's `defaultHeaders { ... }` lambda; the headers of WebClient exchange filters (`filter(...)`, a header set on
  `ClientRequest.from(request)`) and RestClient `requestInterceptor(...)`, and of RestTemplate interceptors given to
  `RestTemplateBuilder.additionalInterceptors(...)` / `interceptors(...)` or added where the template is made
  (`template.getInterceptors().add(i)`, `interceptors = listOf(i)`, `RestTemplate().apply { interceptors.add(i) }`),
  as `clientParts` with `from: "interceptor"`; `exchange(RequestEntity.post(uri).header(...).body(x), ...)` (the
  entity's method, URL, headers and body); `BodyInserters.fromFormData(k, v).with(k, v)` (form).
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
  a `RequestBody`, protobuf, Wire or XML; a `Content-Type` in `@Headers` replaces the converter's. Values come from
  the callers of the interface's methods (#39). A file must import `retrofit2.http` (or the interface be created on a
  Retrofit builder): JAX-RS resources use the same annotation names.
- **Request objects sent by a call** (`requests.ts`, tables in `requests.json`): a request built from a start call and
  steps (also over several statements, through fields, factories and wrappers), reported at the call that sends it.
  The client is the library's when the send is made on one of its objects, or the start call is its (a file importing
  the library, `new HttpPost(...)` resolving to it). A request read through a response (`target.request().get()
  .getHeaders().get("X")`) is not sent again. A wrapper whose request comes from its callers is a wrapper: as an
  argument of a library client (`client.execute(request)`), or a parameter declared with one of the library's request
  types (`requestTypes`: `Invocation.Builder request` with `request.async().method(m, type)`).
  - **Started in several places** (#73, `fluentChains` in `src/lang/ir/fluent-chain.ts`, `request-alternatives.ts`):
    a start in a Kotlin `when` / `if` or a Java `switch` expression or `?:` (`val b = when (verb) { "POST" ->
    c.preparePost(u) else -> c.prepareGet(u) }`), and a variable assigned a start in several branches with nothing
    called on it in between (`case POST: b = c.preparePost(u); break; default: b = ...`), give one call per start, in
    source order, with the steps made after them (`IrRaw.alternatives`; the first keeps the call's id, identical ones
    are reported once). A body or form field set after the split (`if (verb.permitsBody()) b.setBody(x)`) is not the
    GET's or HEAD's. A request factory with several `return`s (`if (version != null) return target.path(version);
    return target;`) is one call, as a URL helper with several returns is in TypeScript: the first return with a
    literal host, else the first, with a `DYNAMIC` method when the returns' methods differ. More than four starts are
    one call, the first, with a `DYNAMIC` method when their methods differ. Calls made on a variable inside a `return`
    (`return target.path(version)`) are not steps of the value the variable has after it.
  - **What the client adds** (#73, `request-defaults.ts`): the headers of Apache's `setDefaultHeaders(List.of(new
    BasicHeader(k, v)))` (`clientParts` `from: "default"`) and of the request interceptors given to its builder
    (`addInterceptorFirst` / `Last`, `addRequestInterceptorFirst` / `Last`: `request.addHeader(k, v)` in a lambda or an
    interceptor class), the headers of JAX-RS filters registered on the client or the target (`register(new
    TokenFilter(t))`, `context.getHeaders().add(k, v)` in `filter`), both `from: "interceptor"`; Unirest's
    `config().defaultBaseUrl(u)` (the global one for `Unirest.get(...)`, an instance's in its file; one base URL only:
    two set for one client are left out) and `setDefaultHeader` / `addDefaultHeader` / `setDefaultBasicAuth`
    (`from: "default"`). Apache's `execute(new HttpHost(...), request)` and `execute(HttpHost.create(url), request)`
    give the base URL of a relative request (HttpClient 4's `(host, port, scheme)`, 5's `(scheme, host, port)`, `http`
    unless given, the port when it is not the scheme's). Vert.x `authentication(new TokenCredentials(t))` is a bearer
    token, `UsernamePasswordCredentials` basic.
  - **Apache HttpClient 4 and 5** (`apache-httpclient`): `client.execute(request)` (also `execute(host, request)`,
    with a response handler, and the async client's `execute(request, callback)`) of `new HttpGet(url)` ...
    `HttpOptions`, `RequestBuilder` / `ClassicRequestBuilder` / `SimpleRequestBuilder` / `SimpleHttpRequests` chains,
    with `setHeader`, `addHeader`, `setEntity`, `setBody(text, ContentType)`, `setUri`; `addParameter(k, v)` is a form
    body for a POST, PUT or PATCH without an entity, query parameters otherwise. The fluent API
    (`Request.Post(url).bodyString(json, ContentType.APPLICATION_JSON).execute()`, `bodyForm(Form.form().add(...)
    .build())`). Entities: `StringEntity(text, ContentType)` (a charset argument is not a content type),
    `ByteArrayEntity`, `UrlEncodedFormEntity` of a list of `BasicNameValuePair`s (`List.of(...)`, or a list filled with
    `add`), `MultipartEntityBuilder.create().addTextBody(...)`; URLs from `URIBuilder` (`setPath`, `addParameter`).
  - **JAX-RS client** (`jaxrs-client`; Jersey, RESTEasy): `client.target(url)` with `path`, `queryParam`,
    `request(...)` (required), `header`, `headers`, sent by `get`, `post(entity)`, `put(entity)`, `delete`, `head`,
    `options`, `method(name, entity)`, `buildX(...).invoke()` / `submit()`, also after `async()`; `Entity.json` /
    `form` / `text` / `xml` / `entity(x, type)` give the encoding, `new Form().param(k, v)` is a form; a response type
    (`Version.class`, `new GenericType<...>() {}`, a `Class<T>` parameter) is not an entity. `resolveTemplate` leaves
    the `{name}` placeholder. JAX-RS resources (`@Path` classes) are endpoints the service serves, never calls.
  - **AsyncHttpClient** (`async-http-client`): `prepareGet(url)` ... `prepare(method, url)` chains ended by `execute`,
    `executeRequest(new RequestBuilder("POST").setUrl(...).build())` and `Dsl.post(url)`; `setHeader`, `addHeader`,
    `addQueryParam`, `setQueryParams`, `setBody`, `addFormParam` / `setFormParams` (form).
  - **Unirest** (`unirest`): `Unirest.get(url)` ... `request(method, url)`, also on an instance, ended by any `as*`
    call (`asJson`, `asString`, `asObject`, their `Async` forms, `asPaged`, `thenConsume`); `header`, `headers`,
    `queryString(k, v)` or `queryString(map)`, `contentType`, `basicAuth`, `body`, `field(k, v)` / `fields(map)`
    (form); `routeParam` leaves the `{name}` placeholder.
  - **Vert.x `WebClient`** (`vertx-webclient`, also the RxJava and Mutiny packages): `get(port, host, uri)`,
    `get(host, uri)`, `get(uri)` ... `request(method, ...)` and the `*Abs(url)` forms, with `putHeader`,
    `putHeaders`, `addQueryParam`, `setQueryParam`, `bearerTokenAuthentication`, `basicAuthentication`, sent by
    `send`, `sendJson`, `sendJsonObject` (JSON), `sendForm` (form), `sendMultipartForm`, `sendBuffer`, `sendStream`
    and their `rx` / `AndAwait` forms. The host and port of the arguments, else the `setDefaultHost` /
    `setDefaultPort` of the `WebClientOptions` the client is created with; `https` with `setSsl(true)` or port 443,
    `http` otherwise; a literal port other than 80 and 443 is in the URL. `new JsonObject().put(...)` and
    `MultiMap.caseInsensitiveMultiMap().add(...)` are bodies.
- **Bodies**: `JSONObject().put(...)` chains (also `val o = JSONObject(); o.put(...)`), `JSONArray`, Gson
  `JsonObject` (and Vert.x's), Jackson `createObjectNode()`, a `HashMap` / `LinkedHashMap` filled with `put` /
  `putAll` or `map["k"] = v` (only once something is put on it, else it stays unread rather than empty), a
  `mutableMapOf()` / `hashMapOf()` filled with `map["k"] = v` (#38: a key set in an `if` / `when` branch or a loop is
  optional), `mapOf(...)` serialized by Gson, Moshi, Jackson or kotlinx, data classes, `LinkedMultiValueMap` (form);
  `HttpHeaders` and OkHttp `Headers.Builder` as header maps.

**Clients a DI container provides** (#46, `src/lang/jvm/di/`, the language's `injection`): a parameter or field
nothing in the code sets gets the value of the binding a container gives it, so a client injected by its type keeps
its builder's base URL, interceptors and default headers.

- **Bindings** (`providers.ts`, indexed once per scan): Dagger / Hilt `@Provides` functions (their declared return
  type, else the type their body builds: `OkHttpClient.Builder()...build()` is an `OkHttpClient`, a project factory's
  return type) and `@Binds` (the implementation class, constructed); Spring `@Bean` methods and stereotype classes
  (`@Component`, `@Service`, ...); CDI `@Produces`; classes with an `@Inject` constructor; Koin definitions
  (`single { ... }`, `factory<T> { ... }`, `single(named("x")) { ... }`, `singleOf(::Repo)`) in files importing
  `org.koin`.
- **Injection points** (`inject.ts`): the parameters of providers, of `@Inject` / `@Autowired` methods and of the
  constructor of a class the container builds (`@Inject constructor`, a stereotype); fields annotated `@Inject`,
  `@Autowired` or `@Resource` (`@Inject lateinit var client: OkHttpClient`); Koin lookups (`get()` in a definition's
  constructor call, `get<T>()`, `by inject()` and `= get()` on a typed property). A constructor parameter of a class
  built only in providers (`@Provides fun repo(c: OkHttpClient) = Repo(c)`, `single { Repo(get()) }`) reads the
  provider's argument. A Spring `@Value` parameter of a bean method reads its configuration value.
- **Which binding**: one of the injection point's own container (a Koin lookup never gets a Dagger binding: a Ktor
  backend next to an Android app), of the same type (the imported class, else the type as written), selected by
  qualifiers: `@Named("x")`, Spring `@Qualifier("x")` (also a bean name), and project annotations annotated
  `@Qualifier` (`@Qualifier annotation class Authed`). A Dagger injection point without a qualifier only sees
  unqualified bindings; a Spring one sees every bean of the type, then the `@Primary` one, then the bean named like the
  parameter or field. Several bindings left (two flavors' modules, two unnamed beans), or none: nothing is attached,
  the call keeps its unknown parts (`tests/fixtures/kotlin/di-ambiguous/`).
- A provider never injects its own parameters (`@Named("raw") client: OkHttpClient` in an `OkHttpClient` provider), and
  each parameter is resolved once per scan.

**Builder steps in `apply { }`** (Kotlin, #46): `Request.Builder().apply { url(u); header(k, v) }.build()`,
`builder.apply { ... }` on a variable, `OkHttpClient.Builder().apply { addInterceptor(i) }` and
`JSONObject().apply { put(k, v) }`: the calls of the lambda made on the receiver (bare, on `this`, or on `it` in
`also { }`) are steps of the value, in place (`CallExpr.applied`, `src/lang/ir/applied.ts`). Client factories
(`fun client(token: String) = OkHttpClient.Builder().addInterceptor(TokenInterceptor(token)).build()`) read their
interceptors' values with the caller's arguments.

**Java.** The detectors read the engine's model only (calls, chains, annotations), and the tables are in
`src/lang/jvm/http/clients.json`, so Java gets the same clients by being lowered into the same model (`new
Request.Builder()` is a call of `Request.Builder`, `X.class` a class reference); `HttpURLConnection` also reads a body
written to a local holding the output stream (`OutputStream os = conn.getOutputStream()`, a `DataOutputStream` around
it). See [Java](#java).

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

**Manifests** (`src/lang/jvm/`, shared with Java): Gradle build scripts in the Kotlin and Groovy DSL
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

- DI (#46): `Lazy<T>` / `Provider<T>` injection points (and a Retrofit `callFactory { lazyClient.get().newCall(it) }`),
  multibindings (`@IntoSet`, `Set<Interceptor>`), Spring beans injected by an interface their class implements or as
  a `List<T>`, Koin `bind` / `binds` and type qualifiers, and service locators other than Koin (Injekt) are not
  followed (#75).
- A member inherited from a base class is only read through `this.x`; a bare `x` resolves to the class's own members.
- Methods of an anonymous `object : Callback { ... }` run as closures of the enclosing code (calls in them are found,
  `this` is the enclosing class's); the anonymous object's own properties are not fields.
- A star import of an external package (`import retrofit2.http.*`) does not tell which names it provides: they stay
  unresolved, except the client classes listed in `wildcardTypes` of `clients.json` (`HttpClient` under
  `import io.ktor.client.*`, `OkHttpClient` under `import okhttp3.*`) when a single star import of the file has it.
  Retrofit annotations are matched by name in a file that imports `retrofit2.http`.
- Retrofit: an interface created on an injected `Retrofit` follows the provider (with its qualifier, the provided
  `Retrofit.Builder` its users finish, and the injected OkHttp client's interceptors, #46); one created on a Retrofit
  of unknown origin, or never created in the project, gets the project's only `Retrofit.Builder()` when there is one,
  else an unknown host (`{baseUrl}`). `create()` without a class reads the function's return type or the variable's
  declared type (`fun api(r: Retrofit): Api = r.create()`). A protobuf or Wire converter only writes generated
  messages: a body of a project class, a collection or a scalar goes to the next converter. `@QueryName` (a parameter name without a value)
  and `@Tag` are not listed, and the keys of a `@QueryMap` / `@HeaderMap` map are only known when the map is.
- `BuildConfig` values from `local.properties` or a computed `buildConfigField` have no default; build types and
  flavors other than the first literal are not listed.
- SDK parameters that are Java objects the SDK serializes itself (Gen AI contents, Firebase `UserRecord.CreateRequest`,
  Twilio creator arguments) give no body. An SDK builder filled in `apply { ... }`, or in steps spread over several
  functions, is not read; keys set in a branch are not marked optional. A path id given inside a params object rather
  than as the first argument stays a placeholder. The `PostHogConfig` host given to `PostHog.setup` is not followed.
- AWS artifacts other than S3 and Bedrock Runtime, the AWS SDK for Kotlin and other JVM SDKs listed in `providers.json`
  are reported as `unsupported` in `coverage.sdks` (#49, #50).

## Java

**Status:** parsed, lowered and resolved by the Kotlin front end (#43): the HTTP clients, Retrofit and Feign declarations
and SDK registries of [Kotlin](#kotlin) apply to Java as they are, since they read the engine's model only; so do the
clients most used from Java (#65: Apache HttpClient, the JAX-RS client, AsyncHttpClient, Unirest, Vert.x `WebClient`),
and Lombok builders and getters are read from the class's annotations.

**One front end for Kotlin and Java.** Android and Spring projects mix the two languages, and the code crosses between
them: a Kotlin repository calls a Retrofit interface declared in Java, a Java activity reads a Kotlin `object`'s
constant. The Kotlin `IrLanguage` lists Java in `alsoReads` (an `IrSource`: id, grammar, extensions, excludes, lowering),
and `scanIr` (`src/lang/ir/scan.ts`) lowers the files of every source language the scan asks for into one module set and
one `ProjectIndex`, the way the TypeScript checker reads TypeScript, JavaScript and HTML together:

- a Java class and a Kotlin file of the same package see each other (`packageScope`), and imports, static imports and
  star imports resolve across the two;
- each module keeps its language (`ModuleModel.language`), so `location.language`, `stats.byLanguage` and
  `diagnostics.languages` are per file;
- the `maven` coverage rows are produced once, from the manifests and the imports of both languages;
- `--language kotlin` or `--language java` reads only that language's files (as `--language typescript` does not load
  JavaScript), so the other language's declarations are not in the index then.

**Lowering** (`src/lang/java/`, grammar `tree-sitter-java`): the module is the file's package, as in Kotlin. Classes,
interfaces, enums and records are classes (nested ones under `Outer.Inner`, seen by their simple name inside the outer
class); `<init>` holds instance field initializers, initializer blocks and the constructor with the most parameters (the
one the others usually delegate to: `this(DEFAULT_URL)`), the other constructors are functions of their own;
`<clinit>` holds `static` field initializers, static blocks and enum constants (an enum constant is a field holding its
construction). Interface fields are constants. A bare name in a method is a local or parameter, then a member of the
class (`this.x`), then a member of an enclosing class (`Outer.x`), then an imported or package name. `new X(...)` is a
call of `X` (`isNew`), `X.class` the class itself (so `retrofit.create(Api.class)` links like `Api::class.java`),
`Foo::bar` a member reference, lambdas are closures, and an anonymous class with one method
(`new Interceptor() { public Response intercept(...) }`) stands for that method; one with several has its methods lowered
as closures of the code around it, as in Kotlin. Annotations of classes, methods, fields and parameters are kept
(`@GET("users/{id}")`, `@RequestMapping(method = RequestMethod.POST, value = {"/a"})`, `@Query("q")`). A setter call on a
local (`headers.setContentType(t)`) is also the property assignment Kotlin would write (`headers.contentType = t`), so
connection settings and header maps read the same in both languages. `try (OutputStream os = conn.getOutputStream())`
and other resources are locals. Generics, wildcards, type annotations and `var` are left out of types; primitive types
are their boxed class (`int` is `Integer`).

**Resolved:** `+` (also `+=`), `String.format`, `"...".formatted(...)`, `String.join`, `new StringBuilder(a).append(b)
.toString()` and a `StringBuilder` local filled by statements before its `toString()`, text blocks (indentation removed
as the compiler does), `String.valueOf(x)`, `System.getenv("X")` (also `System.getenv().getOrDefault`),
`System.getProperty("x", "d")`, Spring `@Value("${x:default}")` on fields and constructor parameters and
`environment.getProperty("x", "default")`, `Optional.ofNullable(x).orElse(d)` and `Objects.requireNonNullElse`, Android
`BuildConfig.X` (with the Gradle literal), `static final` constants (also through `import static`, a library
constant too: `import static javax.ws.rs.HttpMethod.GET`), `switch`
expressions (any of their results), and collection factories (`Map.of`, `Map.ofEntries`, `List.of`, `Arrays.asList`).
POJO fields and records give body shapes, under their `@SerializedName` / `@JsonProperty` names (`transient`,
`@Transient`, `@JsonIgnore` and `static` fields aside); `Optional<T>` and `@Nullable` fields are not required. A
`HashMap` / `LinkedHashMap` filled with `put` is a body like `JSONObject` (a fluent map, Kotlin too); `new HashMap<>(16)`
is a capacity, and a key it `remove`s is not required. `new byte[] {...}` is binary data, not a list.
tree-sitter-java does not parse an annotated varargs type (`String @Nullable ... ids`): a file that fails to parse
is parsed again with those annotations blanked out (same length, `src/lang/java/repair.ts`). Operator chains (`+`,
`&&`) are lowered in a loop, so thousands-long generated concatenations do not run out of stack; other constructs
nested a few thousand deep still skip their file as an `internal-error`.

**Out of scope by default:** Maven `target/`, `.gradle/`, `buildSrc/`, `build-logic/`, test source sets (`src/test*`,
`src/androidTest*`, `src/*Test`), `test/`, `tests/`, `*Test.java`, `*Tests.java`, `*IT.java`.

**Limitations:**

- As in Kotlin, clients provided by a DI container (Spring beans, Dagger / Hilt providers) follow their binding when one
  fits (#46, `tests/fixtures/java/di-spring/`, `tests/fixtures/java/di-dagger/`), a member inherited from a base class
  is only read through `this.x`, and a star import of an external package does not tell which names it provides.
- Code generated at build time is not there: annotation processors (Dagger, AutoValue, MapStruct), protobuf and
  OpenAPI-generated clients. An OpenAPI-generated `ApiClient` checked into the repository is read like any other code.
  Lombok is read from the class's annotations instead (`src/lang/jvm/lombok.ts`, the JVM `resolveCall`): on a project
  class annotated `@Builder` or `@SuperBuilder` (and without a `builder()` of its own), `X.builder().a(1).b(x).build()`,
  also built on a variable, is the dict of the fields it sets, under their `@JsonProperty` / `@SerializedName` names
  (`@SuperBuilder` includes the base class's fields); on a `@Data`, `@Getter` or `@Value` class without the method,
  `x.getA()` / `x.isA()` reads the field `a` when the project sets it (an initializer, a constructor). `@Data`
  classes built with `new X()` and setters give the class's field shape like any POJO. A `@Singular` field's adder
  (`item(x)`, as `@Singular("label")` names it, else the field's name in the singular) appends to the list or, with
  two arguments, sets a key of the map; `base.toBuilder().a(1).build()` (#73) is the dict `base` was built with, then
  the new setters (a local `base` built with a builder).
- A `StringBuilder` filled in a loop or in branches lists every piece appended before `toString()`, once each.
- A call of an overloaded method runs the overload its arguments fit (#73, `src/lang/ir/overloads.ts`, the language's
  `overloads` flag; Kotlin too): by count (named arguments by name, defaults and varargs counted), then by the types
  of literal arguments and of typed parameters and locals; an overload calling its own name delegates to another.
  When all but one hand the call to another of their name (convenience overloads ending in one), that one. Several
  left (a payload of unknown type), and a wrapper call reads each (`src/lang/ir/overload-merge.ts`): the request they
  all reach keeps what they agree on (a URL, method, body or header value they disagree on is unknown, a body they
  encode differently is `raw`), different requests are one call each. A factory or URL helper that is ambiguous is not
  followed. Paths found through an overload other than the first declared come after the others at a call site, so
  its earlier calls keep their ids. Overloads of constructors resolve to the widest one.
- Java records the blocks that may not run (`if` / `else`, loop bodies, `case`s, `catch`), as Kotlin does: a key put
  in a map there is optional, and an `HttpURLConnection` method set there (`if (head) conn.setRequestMethod("HEAD")`)
  is not known (`DYNAMIC`).
- Request objects of the clients above: a JAX-RS filter registered on a client held in a field after it is built
  (`this.client.register(f)` in the constructor), an Unirest instance configured in another file, AsyncHttpClient's
  request filters and the core Vert.x `HttpClient` are not read.

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
  itself and is kept as it is. SDK calls are left out (their registry names the endpoint), except a method whose
  registry entry names the argument holding a GraphQL document (`documentArg`).

| protocol | issue | status |
|---|---|---|
| JSON-RPC (body `method`) | #34 | done: envelope, batch, helpers, branches, computed names (TypeScript, JavaScript, Python, PHP; Kotlin once its HTTP clients land, #32) |
| GraphQL (document: type, name, fields) | #35 | done: documents in bodies, `?query=`, batches, persisted queries, `gql` tags, `.graphql` imports, Octokit (TypeScript, JavaScript, Python, PHP); client libraries (#54): Apollo Client, urql, graphql-request (TypeScript, JavaScript) and `gql` (Python); codegen AST documents and `print()` (#56, TypeScript, JavaScript); Relay, Shopify and `sgqlc` #67; bound diagnostic #55, literal arguments #56 |
| SOAP (`SOAPAction`, `soap:Body`), action-style (`Action=`, `method=`) | #36 | done for requests the code builds (TypeScript, JavaScript, Python, PHP), XML bodies as `xml`; SOAP client libraries (`SoapClient`, zeep, node-soap) are #58 |

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

### GraphQL (#35)

`src/operation/graphql.ts` reads the request every front end resolved; `src/operation/graphql-document.ts` parses the
document with the `graphql` package's parser (no schema, no network):

- **A request** is GraphQL when it sends a document that parses with an operation in it: `query` in a JSON body
  object, the body itself with `Content-Type: application/graphql`, or `?query=` in the URL. `{ query: "red shoes" }`
  is not one, nor `{ query: { match } }`. A `query` the scan cannot read (a parameter) is GraphQL when the envelope
  says so: `variables`, `operationName` or `extensions` beside it, or `graphql` in the path; it gets `name: null`
  (or the literal `operationName`), `dynamic: true` when unnamed. A persisted query (`extensions.persistedQuery` and
  no document) is named by its `operationName`, if any. `from` is `document` when the name was read from the
  document, `body` / `query` when it is `operationName`.
- **The name** is the operation's name; an anonymous operation is named by its root fields, sorted and joined with a
  comma (`{ shop { name } locations { id } }` is `locations,shop`). **`type`** is `query`, `mutation` or
  `subscription`.
- **`fields`** are the leaf paths from the root, aliases resolved to the field name, fragment spreads and inline
  fragments inlined (no type condition in the path), deduplicated and sorted. A spread of a fragment the document does
  not define keeps the field it sits on (`order { ...Elsewhere }` gives `order`).
- **One call per operation.** A JSON array of envelopes is a batch (`batch: true`, the same operation twice once). A
  document of several operations runs the one `operationName` names; with no literal `operationName`, and when a
  branch or a helper's callers give several documents, each operation is a call of its own at that location, without
  `batch`. This differs from JSON-RPC's `alternatives`: each GraphQL operation has its own `type` and `fields`. A
  request of more than 50 distinct operations is one call with `name: null` rather than one call per operation.
- **Where documents come from** (TypeScript / JavaScript, `src/resolve/graphql-source.ts`): string and template
  literals, `gql` / `graphql` tagged templates with their `${Fragment}` interpolations, `graphql("...", [Fragment])`
  calls (gql.tada, the codegen client preset), and `.graphql` / `.gql` files imported by a relative path (`import Doc
  from "./doc.graphql"`, a named import keeps that operation, `require`), with graphql-tag/loader's `#import` lines
  followed four files deep. An imported file is read only inside the scanned directory, symlinks resolved, like a
  config file.
- **Documents written as their AST** (#56, `src/resolve/graphql-ast.ts`): an object literal with `kind: "Document"`
  and `definitions`, as graphql-codegen writes them (typed-document-node, the client preset, the React Apollo
  plugin's `documentMode: documentNode`: `export const GetOrderDocument = {"kind":"Document",...} as unknown as
  DocumentNode<...>`) and as Babel plugins precompile `gql` tags (unquoted keys, `loc`), is read as the text graphql-js
  prints for it, then parsed like any document. Another document's definitions spread or concatenated in
  (`...OrderFieldsFragmentDoc.definitions`, `[op].concat(Fragment.definitions)`) are followed four documents deep,
  each once. `print(doc)` from `graphql` (also `@apollo/client`) sends the text of the document it is given, written
  in any of the forms above. The client preset's `graphql("query ...")` calls are read from their text, as before. Python and PHP read documents in strings, f-strings, concatenations and heredocs through the shared
  engine. A part the scan cannot compute (a `${Fragment}` from a package, a value) is left out of the document
  before it is parsed, so it never reads as a field or as an operation of its own (`` `${city} ${kind}` `` is not a
  document selecting `city` and `kind`); a computed operation name leaves the name unknown.
- **SDKs**: a registry method names the argument holding the document with `documentArg` (Octokit
  `graphql(query, variables)` and `graphql({ query })`, also from `@octokit/graphql`; the GraphQL clients below). The
  argument is the document, or options holding it as `query`, `mutation` (Apollo `mutate`) or `document`
  (graphql-request). A method with `documentArg` sends a GraphQL operation whatever the scan reads of it: a document it
  cannot read gives `name: null`, `dynamic: true`.
- **Client libraries** (#54): Apollo Client, urql and graphql-request (`src/detect/registry/apollo-client.json`,
  `urql.json`, `graphql-request.json`) and Python `gql` (`src/lang/python/registry/gql.json`) are registries of the
  `graphql` provider, a protocol's clients rather than one API: `anyHost` in `providers.json` makes a call's provider
  the one its URL names (`unknown` without one), as for a plain HTTP call, and keeps env var names such as
  `GRAPHQL_URL` from naming it. The registry's `endpoint` says where the client takes its URL and headers
  (`src/detect/endpoint.ts`, `src/lang/ir/endpoint.ts`):
  - the client's construction (`new ApolloClient({ uri, headers })`, `createClient({ url, fetchOptions: { headers }
    })`, `new GraphQLClient(url, { headers })`), followed like any SDK client through variables, imports, class
    fields and factories;
  - else the one transport in the option that hands it one: Apollo's `link` (through variables, arrays, `from([...])`,
    `a.concat(b)`, `split(...)`; `HttpLink`, `createHttpLink`, `BatchHttpLink`, `createUploadLink`), `gql`'s
    `transport` (`RequestsHTTPTransport`, `AIOHTTPTransport`, `HTTPXTransport`, `HTTPXAsyncTransport`). Two
    transports leave the endpoint unknown;
  - a call that names no client (a React hook, `useApolloClient()`, `useClient()`, a typed parameter) uses the
    project's client when the scanned files build exactly one with a URL (a client with its URL, or a transport, of
    that library); an Apollo hook's `client` option names its client instead. Otherwise the host is `unknown`,
    never another client's;
  - a subscription (`subscribe`, `useSubscription`, urql `subscription`) goes through the client's subscription
    transport, usually a WebSocket link or exchange of its own: its endpoint is not read;
  - graphql-request's own `request(url, document, variables, headers)` (also `{ url, document }`) takes the endpoint
    first (`endpointFirst`).
  Headers come from the client or transport and from the call (graphql-request's `requestHeaders`); `authScheme` is the
  one they show, else `unknown` (an auth link or a `fetchOptions` callback is not read). The body is the variables;
  a variable that is a parameter of the hook or helper it is written in is not looked up in its callers (#39): in a
  large React app that is a reference search per hook, for values that are mostly ids.
  The method is `POST`. Not covered yet: Relay, Shopify's clients and `sgqlc` (#67), `@vue/apollo-composable`,
  Apollo's `<Query>` components and `graphql()` HOC.
- **Bounds.** The document comes from a hostile repository: 100,000 characters, 50,000 parser tokens, 32 levels of
  selection sets, 20,000 selection sets visited while inlining fragments, 2,000 field paths. A document read in the
  code is kept to its first 1,000 characters past the size bound, and fragments interpolated into fragments are read
  once each. Past a bound `fields` is left out (not cut short) and `name` / `type` come from the document's header
  when it has one; a diagnostic for this needs a schema change (#55). An AST document is read only while every
  definition is a JSON-like literal (strings, numbers, booleans, `null`, arrays, objects; `__proto__` keys dropped),
  within 4,000,000 characters, 200,000 values and 128 levels of nesting; otherwise its first operation's type and
  name are kept, and its fields left out. The text it prints to has the bounds above.
- **Not covered**: literal arguments of selected fields (#56, a schema change); AST documents built by code
  (`Object.assign`, a definition pushed after the literal) and Python documents written as `graphql-core` nodes.

### SOAP and action-style APIs (#36)

**XML bodies.** A string body that is an XML document (a declaration or an element first, markup last) is
`bodyEncoding: "xml"`, in every language, whether the string is a literal, a template, a `format()` / f-string /
heredoc / concatenation, or a variable holding one (`src/resolve/xml-shape.ts`). Its shape is its element structure:
an object holding the root element, whose value holds the child elements, down to the leaves' text (a literal is a
one-value enum, a computed part a `string` with the part's name as `hint` and a `dynamic` entry). A repeated element
is an array; attributes and namespace declarations are left out; a computed element name sets `dynamicKeys`.
A body built by an XML library is `xml` with its value unread: `XMLSerializer.serializeToString`, `ET.tostring`,
`xmltodict.unparse` (its dict is the shape), minidom `toxml()`, PHP `asXML()` / `saveXML()`. A body the scan cannot
read (a parameter, a call) sent with an XML content type (`text/xml`, `application/xml`, `application/*+xml`) is
`xml` too; a body read as an object or an array keeps its encoding. Example requests write the shape back as XML
(`application/xml`, curl `--data-raw`).

Markup is not an XML document: a string whose root is an HTML or SVG element in lower or upper case (`<p>`, `<html>`,
`<svg>`; `<Table>` is an API's element), text that only looks like a tag (`<b>`, `<Unclosed>`), and a malformed
document with no `<?xml` declaration keep their previous encoding. A body read as XML but sent with another declared
content type (`text/html`, `application/json`) is `raw` text.

The document comes from the scanned repository: the reader in `xml-shape.ts` is a small tokenizer, not an XML
library. It never reads a DTD (`<!DOCTYPE ...>` is skipped, its entities are never expanded; only the five predefined
entities and character references are decoded), stops at 64 KiB, 500 elements and depth 32 (such a document is a
plain `string` body, still `xml`), and stops at the first token it cannot read (an unterminated comment or CDATA
section), so it reads a text once.

**SOAP** (`src/operation/soap.ts`). A request is SOAP when it sends a `SOAPAction` header, a SOAP 1.2 content type
(`application/soap+xml`), or an XML body whose root is an `Envelope` (any prefix). The operation's `name`:

- the `SOAPAction` value's last segment (`http://example.com/Svc/Track`, `urn:example:Track`, `Svc#Track` give
  `Track`), `from: "header"`; a helper that takes the action gets each caller's (wrapper expansion), and the request
  inside the helper lists them as `alternatives`;
- else the `action=` parameter of a SOAP 1.2 content type, also `from: "header"`;
- else the local name of the first element inside the envelope's `Body` (`CancelShipment`), `from: "body"`;
- else `name: null`, `dynamic: true`.

**Action-style APIs** (`src/operation/action.ts`). Which parameter names the operation is data: the provider's
`operationParam` in `src/normalize/providers.json` (`aws`: `Action`, `flickr`: `method`). A call to such a provider
with that parameter in its query (URL or a `params` object) gets `operation: { protocol: "action", name, from:
"query" }`; in a form body, `from: "body"`. A branch gives `alternatives`, a computed value `dynamic`. A provider
without `operationParam`, or a call without the parameter (an S3 REST call), has no operation. Adding a provider is
one line in `providers.json`.

**Not covered:** SOAP client libraries that build the envelope from a WSDL (PHP `SoapClient`, Python zeep, node-soap,
JAX-WS / Spring-WS) send no request the scan sees; they are #58, which needs a decision on their `client` value. The
endpoint a WSDL declares is never read.

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
| Kotlin, Java | does not apply: every parameter has a type, and one that names no client stays unresolved (`typedParams`) |

## Keys added after a dict is built (#38)

Code that adapts one call to several models or API versions often builds the arguments and then completes them:
`kwargs["max_tokens"] = 64` in one branch, `kwargs["max_completion_tokens"] = 64` in the other. For a variable that
becomes a call's arguments or body, the statements of the same function that run before the call change its keys:

| language | adds | removes |
|---|---|---|
| Python | `kwargs["k"] = v`, `kwargs.update(k=v)`, `.update({...})`, `.update(**other)`, `.setdefault("k", v)`, `kwargs \|= {...}`, `kwargs = {**kwargs, ...}` | `del kwargs["k"]`, `kwargs.pop("k")` |
| TypeScript / JavaScript | `params.k = v`, `params["k"] = v`, `Object.assign(params, {...})` | `delete params.k`, `params.k = undefined` |
| PHP | `$params['k'] = $v`, `$params += [...]` (keys not set yet), `$params = array_merge($params, [...])`, `$data['k'] = $v` with no `$data = [...]` before | `unset($params['k'])` |
| Kotlin | `map["k"] = v` on a local `mutableMapOf(...)` / `hashMapOf(...)`, or on a `HashMap()` (an entry of the fluent map, `src/lang/ir/fluent.ts`) | |

- **Branches.** Every key set on some path is reported. A key set in a block that may not run (an `if` branch, a loop
  body, a `case`, an `except` / `catch`, the right side of `&&`) is left out of `required`, unless every branch of an
  `if` / `elif` / `else` chain sets it. Values set on several paths merge as alternatives (`model: ["gpt-4o-mini",
  "o3"]`), and literal values count for the `model` fact like those of a dict literal.
- **Order.** Only statements before the call count; a later edit, or one in a nested function or callback, does not. A
  removal in a branch makes the key optional; an unconditional one drops it.
- **Where.** Python, PHP and Kotlin: the front ends lower each statement as an edit of the variable (`Assign.edit` in
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

| issue | TypeScript / JavaScript / HTML | Python | PHP | Kotlin and Java |
|---|---|---|---|---|
| #3 Supabase, Firebase, Sentry registries; no-crash scans | done | supabase-py (tables, rpc, auth, storage, functions), firebase-admin (Firestore references, Auth, FCM), sentry-sdk (`capture_*`, not `init`); per-file parse / internal errors | kreait/firebase-php (typed services too), google/cloud-firestore, sentry/sentry (+ Laravel, Symfony); no official Supabase SDK | Firestore (google-cloud-firestore, firebase-admin, Android), firebase-admin Auth, FCM and Realtime Database, sentry-java / sentry-android capture calls (#33); supabase-kt listed in `providers.json` (#50); per-file parse / internal errors |
| #4 diagnostics | done | parse errors, internal errors, dropped calls, `injected-client`, `injected-fetch`, `wrapper-depth`, per-language file counts | same | same; a typed parameter that names no client is not an `injected-client` |
| #5 regression fixtures and recall | done; `tests/fixtures/{javascript,html}/**/expected.json` too | `tests/fixtures/python/**/expected.json` are part of the recall check | `tests/fixtures/php/**/expected.json`, same check | `tests/fixtures/kotlin/**/expected.json` and `tests/fixtures/java/**/expected.json` (the same clients in Java, a mixed Kotlin / Java project, #43): OkHttp (interceptors too), `java.net.http`, Ktor, Spring, Feign, Retrofit, clients a DI container provides (`di-*`, #46), the SDK fixtures of #33 (`tests/fixtures/kotlin/sdk/`), negatives (server endpoints, JAX-RS resources, gRPC, builders of other libraries) |
| #6 provider roadmap | done | registries for every P1 / P2 provider with a Python SDK; `providers.json` lists PyPI packages per provider | the same for Packagist | Maven artifacts per provider in `providers.json`; registries for OpenAI, Anthropic, Stripe, AWS S3 and Bedrock Runtime, Gen AI, Firebase, Twilio, Slack, Sentry, PostHog (#33), the rest in #49 / #50 |
| #7 SDK coverage | done | PyPI manifests, import names (`modules.json`), `ecosystem: "pypi"` | `composer.json`, namespaces per package (`namespaces.json`), `ecosystem: "composer"` | Gradle (Kotlin and Groovy DSL, version catalog) and `pom.xml`, package roots (`src/lang/jvm/packages.json`), `ecosystem: "maven"`; a declared artifact's roots win over an undeclared one's |
| #8 provider resolution | done | env defaults, env var names, URL helpers, class base URLs; no template in `provider` | `env('X', 'default')`, `getenv() ?: '...'`, Laravel `config()` files, class constants, helpers, `$this->baseUrl` | `System.getenv("X") ?: "..."`, `System.getProperty`, `BuildConfig.X` with its Gradle literal, Spring `@Value("${x:default}")`, constants, `object` and companion members |
| #30 operation outside the URL | `operation` field and its name in `id`; JSON-RPC (#34) and GraphQL (#35) from the body shape, query and SDK document argument; `gql` tags, `.graphql` imports, codegen AST documents (#56), Octokit `graphql()`, Apollo, urql and graphql-request (#54); SOAP and action-style APIs (#36) from headers, the XML body and the query | JSON-RPC, GraphQL, SOAP and action-style APIs from the body shape, headers and query; the `gql` client (#54) | JSON-RPC, GraphQL, SOAP and action-style APIs from the body shape, headers and query | same engine; no JSON-RPC, GraphQL or SOAP fixture yet |
| #37 SDK client as an untyped parameter | callers, manifests, `receiver-unknown`, `clientFrom`; not constructor parameters stored on `this` | callers (constructors too), manifests, `receiver-unknown`, `clientFrom` | same as Python | does not apply (parameters are typed) |
| #39 a parameter's values | initializers and callers through checker references | defaults and callers through the IR | same | same engine (Kotlin parameter defaults are lowered); Retrofit interface methods get their callers' arguments and defaults (`tests/fixtures/kotlin/retrofit/`, the Android fixture); SDK wrappers read their callers' values like Python |

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

A language whose needs go beyond the IR (a type system the engine should use, like C#) can implement
`Language` directly, as TypeScript does. A language that shares its ecosystem and its code with another (Java with
Kotlin) is an `IrSource` in that language's `alsoReads`, so both are lowered into one index.

| next candidates | ecosystem | notes |
|---|---|---|
| Go | Go modules (`go.mod`) | `net/http`, `resty`; SDK clients are structs (`stripe.Key`, `client.Customers.New(params)`) |
| Ruby | RubyGems (`Gemfile`) | `Net::HTTP`, `Faraday`, `HTTParty`; SDKs are mostly module-level (`Stripe::Customer.create`) |
| C# | NuGet | `HttpClient`, RestSharp, typed SDK clients |
