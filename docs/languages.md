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
| Go | supported: `net/http` (and go-retryablehttp, fhttp), Resty, SDK registries | tree-sitter + shared engine | Go modules | `go.mod` |
| Shell | supported: curl, wget and HTTPie command lines | tree-sitter (bash grammar), read directly | none | none |
| Rust | supported: reqwest, ureq, awc, surf, isahc, SDK registries | tree-sitter + shared engine | crates.io (Cargo) | `Cargo.toml` (workspaces too) |
| Dart | supported: package:http, Dio, supabase_flutter | tree-sitter (a grammar built from source, committed) + shared engine | pub.dev | `pubspec.yaml` |

## Goals

- **One report for a whole repository.** A repository often holds a TypeScript front end and a Python or PHP back end.
  `api-grep scan` reads every supported language it finds (or the ones given with `--language`) and writes one report.
- **Say where each call comes from.** Every call carries `location.language`; `stats.byLanguage` counts calls per
  language, `diagnostics.languages` counts files seen and scanned per language, and each `coverage.sdks` row names its
  `ecosystem` (`npm`, `pypi`, `composer`, `maven`, `go`, `cargo`, `pub`), so the same package name in two ecosystems (`openai`) is two rows.
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

- `src/lang/types.ts` defines a `LanguageFrontEnd`: an id, an ecosystem (none for shell), file extensions and a `scan` that returns `Call`s,
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
types once it has made 400,000 types or 3 million instantiations, and a new checker makes again those it needs; a
project whose detection made a quarter of that starts building its calls with a new checker too (the types detection
made are mostly not those building reads: a 35 MB group built its calls with 150,000 of them held, at its 2 GB heap). The
trigger is a count, not the heap: a new checker can type a few expressions differently (TypeScript's inference depends
on the order it meets types), and a report must be the same whatever the heap or the machine. Imports are resolved by
`src/module-resolution.ts`, which keeps what it found and not every path it tried (the checker's own keeps them for
watch mode: hundreds of megabytes in a repository scanned without `node_modules`). A batch's project and the file
graph read the disk through `src/bounded-fs.ts` (#112): only `readRoot()` (`src/tsconfig.ts`) exists, the repository
root (the nearest directory holding `.git`, a directory or a worktree's file) when the scanned directory is in a git
repository, else the scanned directory itself (an archive the server unpacked). A subdirectory of a monorepo still
reads the sibling packages and wrappers it imports; nothing above the root does, also once symlinks are resolved:
neither `node_modules` nor `node_modules/@types` is looked for above it, a `/// <reference path>` or a `paths` alias
out of it reads as a missing file, and TypeScript's current directory is the root, not the one the scan runs from. A
report is then the same from any checkout location (a stray `~/node_modules` used to type a few bodies, and the eval
read the scanning tool's own packages for repositories cloned under it). The tsconfig is looked for in the scanned
directory and up to four directories above, never above that root (the eval used to read the tool's own tsconfig); it
is parsed once (`scopeOf`) for its options, it and what it extends read inside the root. Union members of a type are
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

Python, PHP, Kotlin, Java, Go and Rust are read without a type checker (Kotlin's, Java's, Go's and Rust's declared types are kept, not checked), but they share
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
| `conditional.ts` | the steps of code run for each request (interceptors, filters) that run on some requests only: in a branch, a loop, after an early return (`clientParts` `optional`, #69) |
| `detect.ts`, `wrappers.ts` | detection per function, wrapper expansion up to four deep, `injected-client` / `injected-fetch` / `wrapper-depth` diagnostics |
| `receiver.ts` | SDK calls on untyped parameters: the clients callers pass, else the one declared SDK, else `receiver-unknown` (#37) |
| `extensions.ts` | Kotlin extension functions: the extension a member call runs, by the receiver type of its value's chain (#86) |
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
spec) by `pnpm gen:stripe-ports`. The Telegram registries of every language (node-telegram-bot-api, telegraf, grammY,
python-telegram-bot, aiogram, pyTelegramBotAPI, irazasyed/telegram-bot-sdk) are generated by `pnpm gen:telegram` from
one Bot API method list (`scripts/telegram/methods.ts`) and each library's naming and positional parameters
(`fieldArgs`). The other registries were written against each SDK's own request code; their notes
(versions checked, calls that send nothing) are in each file's `$comment` and `generatedFrom`. PHP 8 named arguments
use the keyword-argument fields (`bodyKwargs`, `kw:<name>`), like Python.

## Python

**Detected:** `requests` (functions and `Session`; `requests_hardened` `Manager().send_request`), `httpx` and `httpx2`
(functions, `Client` / `AsyncClient` with `base_url`), `aiohttp` (`ClientSession`, positional or keyword base URL),
`urllib.request` (`urlopen(url, data)`, `urlopen(Request(url, data, headers, method=...))`, `urlretrieve`), `urllib3`
(`PoolManager().request`), and the SDKs in
[`sdk-support.md`](sdk-support.md) (OpenAI and Azure OpenAI, Anthropic and its Bedrock / Vertex clients, Google Gen AI,
Google Generative AI, Supabase, Firebase Admin, Google Cloud Firestore, Sentry, Stripe, boto3 S3, Bedrock runtime, DynamoDB, SES, SES v2, SQS and SNS,
Twilio, Slack, Resend, PostHog, Mistral, Groq, Cohere, ElevenLabs, Convex, python-telegram-bot, aiogram,
pyTelegramBotAPI, discord.py and its forks, huggingface_hub). Jupyter notebooks (`.ipynb`) are read as the Python of
their code cells (`src/lang/python/notebook.ts`, through the IR's `readText` hook): each source line on the line of
the JSON string holding it, so a call's line is its line in the notebook; shell escapes (`!pip`), line magics and
cells of another language (`%%bash`) are left out, cells run in order so a later cell sees an earlier one's values, a
cell that is no Python (a shell command without `!`) is left out rather than losing the notebook, and a notebook of
another kernel reads as empty. A notebook not in nbformat's one-string-per-line layout (a `source` given as one
string, a notebook on one line) is a `parse-error`; a call's column is its column in the cell's line, not in the JSON
line.

**Resolved:** f-strings, `+`, `%`, `.format()`, `"/".join([...])`, `urljoin`, `os.getenv("X", default)`,
`os.environ["X"]` / `.get`, python-decouple `config()` and django-environ `env()`, module constants (also imported from
project modules, relative imports and `src/` layouts), class attributes, `self.x` set in any method (the subclass's own
first when a base class method runs on it), parameter defaults,
`x or "https://..."` defaults, URL helpers (`def api_url(m): return f"..."`, lambdas), local annotations
(`db: Client = ctx.db`), fields of objects built in the project and passed down (`Call(base="https://...")` for a
dataclass, NamedTuple or pydantic model, `self.url` set in `__init__`, `replace(call, ...)`), literal `.replace()` and
`re.sub` (the pattern is never run). SDK clients are also followed through `@property` / `@cached_property` methods
(`self.client` built on first use), dataclass and pydantic fields' defaults (`field(default_factory=OpenAI)`), FastAPI
dependencies (`client: OpenAI = Depends(get_client)`, typed or not: what the dependency returns or yields), and
factories and fields holding one of several SDKs' clients (`return Anthropic() if claude else OpenAI()`,
`self._client` set to either in `__init__` branches: the client whose registry has the method called), and names an
`except ImportError:` fallback sets to `None` (still the import). A field set in several places gives a body value any
of its values (`self.model = model or "a"` in one branch, `"b"` in another). A method run by a standard helper is that
call: `asyncio.to_thread(client.messages.create, model=m)`, `loop.run_in_executor(None, functools.partial(fn, ...))`,
`executor.submit(fn, client, ...)` (beside the `submit` call), a `partial` held by a local and called later;
`getattr(obj, "create")` with a literal name is `obj.create`. Bodies come from dict literals, `**spreads`, `dict(...)`, `json.dumps`, `urlencode`,
`.model_dump()`, and declared dataclass / TypedDict / pydantic types, with the keys added or removed later in the same
function, before the call (see [Keys added after a dict is built](#keys-added-after-a-dict-is-built-38)).

**Out of scope by default:** `tests/`, `test/`, `integration_test/`, `integration_tests/`, `test_*.py`, `*_test.py`, `conftest.py`, virtualenvs (`.venv`, `venv`,
`site-packages`), caches. Files a scan excludes are still read so imports resolve through them, as in TypeScript.
An import that resolves to a module of the repository (its own `agents/` package) is not counted as the PyPI SDK of
that name in `coverage.sdks`.

**Limitations:**

- No type inference beyond annotations: an untyped parameter used as an HTTP client (`def run(session):
  session.post(url)`) is listed in `diagnostics.unfollowed` as `injected-client`. An untyped parameter used as an SDK
  client is followed to its callers ([below](#sdk-clients-passed-as-untyped-parameters-37)).
- SDK methods passed as callbacks to other functions (`retry(stripe.Customer.create, email=...)`) are not followed; the
  SDK shows as `imported-no-calls` in coverage.
- `getattr(client, name)(...)` with a computed name, `**kwargs` forwarded through several layers, and module-level configuration
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
Resend, PostHog, SendGrid, Mailgun, jolicode Slack, irazasyed/telegram-bot-sdk).

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
AWS (S3, Bedrock Runtime, DynamoDB, SQS, SNS, SES and SES v2 from the AWS SDK for Java 2.x and the AWS SDK for Kotlin,
the S3 Transfer Manager and the DynamoDB Enhanced Client, S3 from the AWS SDK for Java 1.x: #49), Google Gen AI, Firestore (google-cloud-firestore, firebase-admin's
`FirestoreClient`, the Android SDK), Firebase Admin Auth, Cloud Messaging and Realtime Database, Twilio, Slack, Sentry
and PostHog (the Android / JVM facade and posthog-java); with #50 the community openai-kotlin client, Azure OpenAI,
LangChain4j's OpenAI, Anthropic, Gemini, Mistral, Ollama and Bedrock models, Firebase for Android (Auth, Realtime
Database, Storage, callable Functions), supabase-kt (Postgrest, Auth, Storage, Functions), SendGrid, Resend and
Mailgun; with #89 Spring AI's OpenAI, Anthropic, Mistral AI and Ollama models, with #96 its Azure OpenAI, Bedrock
Converse, Google GenAI and DeepSeek models (below). The registries are in
`src/lang/jvm/registry/`, keyed by Maven coordinates and fully qualified classes, so Java reads them as they are.

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
  A lambda given to a setter fills a nested object (`destination(d -> d.toAddresses(to))`); the AWS SDK's
  `applyMutation(b -> ...)` sets the builder's own fields.
  A builder filled in Kotlin's `apply { ... }` (`Params.builder().apply { model(m) }.build()`, `builder.apply { ... }`
  on a variable) reads its lambda's calls as setters; a setter called in a branch or a loop body before `build()` gives
  an optional field (#50).
- **AWS** (#49): the AWS SDK for Kotlin has the Java 2.x SDK's operations under the same names, so one registry per
  service holds both (`variants`: package, imports, client factories and model package of each). Its clients are
  `S3Client.fromEnvironment { region = r }` or `S3Client { ... }` (`endpointUrl = Url.parse(u)` in that lambda replaces
  the host), and its requests are built by lambdas that assign properties: `PutObjectRequest { bucket = b; key = k }`,
  `s3.putObject { ... }`, a nested member filled by a call with a lambda (`inferenceConfig { maxTokens = 512 }`). The
  Kotlin lowering keeps a lambda's assignments to names it does not declare, and `this.x = v`, on `FunctionDef.props`;
  `src/lang/ir/builders.ts` reads them as setters, and a call of a class of the parameter packages with a lambda
  (`X { ... }`) as a built value. DynamoDB and SQS speak AWS JSON 1.0 (POST `/`, the operation in `X-Amz-Target`), SNS
  and SES the Query protocol (`/?Action=Publish`, form fields, as the TypeScript `aws-sdk` registry writes them), SES
  v2 REST JSON; the operation is the call's `operationId` (an SDK call carries no `operation`, in every language). The
  DynamoDB Enhanced Client's operations (`table.putItem(item)`, on `enhanced.table(...)` or a `DynamoDbTable<T>`)
  send a mapped object the SDK serializes: no body. The S3 Transfer Manager's body is the S3 request it wraps
  (`bodyProp`). The SDK for Java 1.x takes the bucket and key as positional arguments (`s3.putObject(bucket, key,
  file)`: `pathArgs`); a request object (`new PutObjectRequest(...)`) is not read. Presigners
  (`S3Presigner`, `generatePresignedUrl`) sign locally and send nothing.
- **More forms** (#50): Kotlin data classes of an SDK built by named constructor arguments
  (`ChatCompletionRequest(model = ModelId("gpt-4o"), maxTokens = 100)`: `setters.constructors`; `ModelId(...)` and
  `OpenAIHost(baseUrl = u)` stand for their argument, `setters.wrappers`); Pascal-case constants (`ChatRole.User` ->
  `user`: `constants` style `lower`). Body fields an SDK names itself from positional arguments and setters of the
  chain (`argFields`: Twilio `Message.creator(to, from, body).setMediaUrl(u)` -> `To`, `From`, `Body`, `MediaUrl`;
  Firebase `signInWithEmailAndPassword(email, password)`). A model client built here is the call, its request settings
  the body, like the Python LangChain clients (`bodySelf`: LangChain4j `OpenAiChatModel.builder()...build()`). A URL
  given as an argument (`urlArg`: Slack's `Slack.getInstance().send(webhookUrl, payload)`). A host set by a
  configuration call made once elsewhere (`setupUrl`, `src/lang/ir/setup.ts`: `PostHog.setup(PostHogConfig(key, host =
  h))`, then `PostHog.capture(...)` anywhere; several different setups leave the registry host). A path id given inside
  the params object (`files().retrieve(FileRetrieveParams.builder().fileId(id).build())`). Kotlin's index operator on
  an SDK object is its `get` (`indexOperator`: supabase-kt `postgrest["table"].select()`). An object filled by setters
  before it is sent (SendGrid's `Request` with `setEndpoint("mail/send")`, `setBody(...)`: the `setters` of a fluent
  map in `clients.json`), and the HTTP method it sets (`setMethod(Method.GET)`, `methodFrom`; a request given none is
  a POST, one given a parameter `DYNAMIC`, #89).
- **Forms of #89:** option objects filled by setters on a constructor (Azure OpenAI `new
  ChatCompletionsOptions(messages).setMaxTokens(300)`, also on a variable: a fluent map with `args`, the constructor's
  arguments, and `setterCase`, `setMaxTokens` -> `max_tokens`; a setter called in a branch gives an optional field, for
  every fluent map read on a variable). Bodies built by supabase-kt lambdas: the properties `signInWith(Email) { email =
  e }` assigns (the entry's `setters`, `bodyArg` 1) and the keys `update({ set("done", true) })` sets
  (`setters.putters`; a key set in a nested lambda, `x?.let { set(...) }`, is optional; a lambda setting none the scan
  reads is not an empty body). Kotlin properties whose getter sends a request (Firebase Storage's `ref.downloadUrl`:
  registry methods with `property`, recorded by the lowering as for web3.py, `src/lang/kotlin/property-reads.ts`).
  Mailgun's EU host given to the two-argument `MailgunClient.config(baseUrl, key)` (`instance.urlArg` `"0/2"`: argument
  0 of a call given two positional arguments; a base URL's trailing slash is not doubled). A builder filled across
  several functions (`src/lang/ir/builders.ts`): one a project method returns (`base().addUserMessage(q).build()` with
  `fun base() = Params.builder().model(m)`) and one a builder variable gets from a helper it is given to (`tone(params,
  formal)`, the helper's steps on its parameter, optional when the helper call or the step may not run). A constant of
  a nested project class (`Supabase.Column.TEXT`, Java static nested classes too) is its value.
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

**Spring AI** (#89, `src/lang/jvm/registry/spring-ai.json` expanded by `spring-ai.ts`, the language's `refineSdk` in
`src/lang/jvm/spring-ai.ts`): the code talks to beans the build's starter configures.

- **Calls:** a `ChatClient` chain is one request, at its `call()` or `stream()` (`chatClient.prompt().user(q).options(o)
  .call().content()`: `user`, `system`, `options`, `advisors`, `tools`... are `builders`), on a client from an injected
  `ChatClient.Builder` (`builder.defaultSystem(s).build()`, also `mutate()`), `ChatClient.create(model)` or
  `ChatClient.builder(model).build()`; `ChatModel.call(prompt)` / `stream`, `EmbeddingModel.embed` / `call`,
  `ImageModel.call`, the transcription and speech models. Reading the response (`.content()`, `.entity(...)`) is the same
  request. One entry per provider (OpenAI, Anthropic, Mistral AI, Ollama; with #96 Azure OpenAI, Bedrock Converse,
  Google GenAI, DeepSeek), artifact (the module `spring-ai-openai`, the 1.0 starter `spring-ai-starter-model-openai`,
  the milestone starter `spring-ai-openai-spring-boot-starter`; a kind can list its own, Google GenAI's embedding
  starter) and kind (chat, embedding, image, transcription, speech), with `configured` (`ConfiguredClient` in
  `src/lang/ir/language.ts`). A path holding the model (Azure's `/openai/deployments/{deployment}/chat/completions`,
  Bedrock's `/model/{modelId}/converse`, Gemini's `/v1beta/models/{model}:generateContent`) reads it through the param
  source `model` (the call's model); `stream` calls have their own path where the API does (`converse-stream`,
  `:streamGenerateContent`).
- **Provider:** the interfaces (`ChatClient`, `ChatModel`) are shared: a chain through a provider's own class
  (`OpenAiChatModel`, also the model `ChatClient.builder(model)` gets) is that provider's; otherwise the provider is the
  one model starter or module of that kind the manifests between the file and the scanned directory declare (an
  Anthropic starter next to OpenAI's gives no `EmbeddingModel`). With several (#96, `src/lang/jvm/spring-ai-beans.ts`):
  the bean a `@Qualifier("anthropicChatModel")` (or the beans DSL's `ref<ChatModel>("name")`) names on the injection
  point the client or model comes from (through locals, fields and `ChatClient.builder(m)`), else the provider
  `spring.ai.model.chat` (`.embedding`, `.image`, `.audio.transcription`, `.audio.speech`) keeps, else the bean named
  like the parameter or field (`ChatModel openAiChatModel`, Spring's fallback). Nothing of these: no call, the bean
  could be either (Spring would refuse to start; listing one call per provider would list a request that is never
  sent). Google GenAI with `spring.ai.google.genai.project-id` set goes to Vertex AI: no call. A starter declared and
  none of its classes imported counts the shared interfaces' imports for it in `coverage.sdks` (`declaredOnly` roots;
  the module's own declaration first, `src/lang/ir/scan.ts`).
- **Model and base URL:** the model the code sets wins (the prompt's `options(X.builder().model(m))`, the request
  object's options: `new Prompt(text, options)`, `new EmbeddingRequest(texts, options)`, a client's or model's
  `defaultOptions`; options the scan cannot read leave it unknown), else the module's
  `src/main/resources/application.yml` / `.yaml` / `.properties` (`spring.ai.<provider>.<kind>.options.model`, 2.0's
  `spring.ai.<provider>.<kind>.model`, Azure's `options.deployment-name`; `base-url` of the kind, then of the provider,
  Azure's `endpoint`), read as `@Value` reads a property: the property named by its key with the file's value as
  default, `${X:d}` in the value an environment variable with its default (`src/lang/jvm/spring-config.ts`), else the
  starter's default model in the Spring AI release the build declares (the starter's version, else the `spring-ai-bom`
  one of a Gradle `platform` or a Maven `dependencyManagement` import, `Manifests.bom`), as the same property read with
  that default. A base URL ending in `/v1` (Spring AI 2's OpenAI) is not doubled for paths starting with `/v1`, and one
  that names another known provider (`https://api.groq.com/openai`) gives that provider, as for any SDK. A model built
  in the code (`OllamaChatModel.builder().ollamaApi(api).defaultOptions(o).build()`) ignores the properties: its API
  object's `baseUrl(...)`, unknown when the API object cannot be read. The model is reported `from: "argument"`; no
  body is listed (the provider's request is built by Spring AI).
- **Model enums and defaults** (#96, `src/lang/jvm/spring-ai-models.ts` over `registry/spring-ai-models.json`):
  Spring AI's enums (`OpenAiApi.ChatModel`, `AnthropicApi.ChatModel`, `MistralAiApi.ChatModel` / `EmbeddingModel`,
  `OllamaModel`, `DeepSeekApi.ChatModel`, OpenAI's image and audio models) read by `getValue()`, `getName()`, `id()`,
  Kotlin's `.value` or as the constant itself, imported or written fully qualified; openai-java and anthropic-java
  constants (`com.openai.models.ChatModel.GPT_4O_MINI.asString()`, used by Spring AI 2) by their registries' rules
  (`sdkConstant` in `src/lang/ir/builders.ts`). The table was read from the sources of every release from 1.0.0 to
  2.0.1: a constant whose value changed (`MISTRAL_SMALL` is `mistral-small-2603` from 2.0.1) needs the declared release,
  and a default model needs a release of the table; otherwise the model stays unknown.
- **Configuration files** are read through `readConfigFile` (hostile input, symlinks inside the scanned directory, 4
  MB at most), line by line with linear patterns, at most 20,000 lines (`spring-config-parse.ts`): the default
  documents, then the files `spring.config.import` names on the classpath (`optional:classpath:llm.properties`, at
  most 8), then the profiles `spring.profiles.active` names (literal or a placeholder's default, at most 4): their YAML
  documents (`spring.config.activate.on-profile` or `spring.profiles` naming the profile; a profile expression such as
  `!prod` matches none), `#---` documents of a `.properties` file, and `application-<profile>.*`, each over the ones
  before. Nested block mappings with scalar values (lists, block scalars and flow collections are skipped), keys matched
  by Spring's relaxed binding (`base-url`, `baseUrl`, `base_url`), `.properties` over YAML.
- **Kotlin beans DSL** (#96): `ref<ChatClient>()` in `beans { bean { ... } }` (a file importing
  `org.springframework.context.support.beans`) is the project's bean of that type, else one the starter makes (the
  injection hook `lookupType`); the grammar reads `ref<ChatModel>("name")` as two comparisons, lowered as the call
  (`typedCall` in `src/lang/kotlin/lower-expr.ts`, also for Koin's `get<Api>(named("x"))`).

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
  `Credentials.basic(user, password)` is `Basic <credentials>`, so an `Authorization` header set to it (on the request
  or in an interceptor, also through a variable) is basic auth (#69, `src/lang/jvm/http/bodies.ts`).
- **Interceptors**: the headers and query parameters an interceptor sets (a lambda, `Interceptor { }`, an
  `object : Interceptor`, or a project class with its constructor arguments) apply to every call of the client built
  with it (`addInterceptor`, `addNetworkInterceptor`, kept through `newBuilder()`, variables, fields, `by lazy` and
  factories). They are in `query` / `headers` and `authScheme` like any other, and listed in `clientParts` with
  `from: "interceptor"`. Headers set on a response (`chain.proceed(...).newBuilder()`, `Response.Builder()`) and
  one-argument reads (`request.header("X")`) are not the request's. A header or query parameter the interceptor sets
  on some requests only has `optional: true` in `clientParts` (#69, `ir/conditional.ts`): set in a branch or a loop
  body (`if (url.contains(...))`, a `when` entry, `x?.let { ... }`, Java's `ifPresent` / `forEach` lambdas), after an
  early `return` that may run (`if (!allowed) return chain.proceed(request)`, `x ?: return ...`), or in a builder
  extension or local helper that sets it in a branch or is called in one. A name every branch of an `if` / `else` or
  an exhaustive `when` sets, or that the call (or another interceptor) always sets, is not optional. The same applies
  to Spring interceptors and filters, Apache request interceptors and JAX-RS filters. Kotlin and Java lower each
  `return`'s offset as `FunctionDef.exits`. `okHttpClientFacts(client, ctx)` (`okhttp.ts`, over
  `interceptor-steps.ts`) gives them for any client expression: Retrofit reads the client of `.client(okHttp)` with it.
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
  `headerValues`; a line built from constants or a template, `"Accept: $ACCEPT_JSON"` or `"Accept: " + ACCEPT_JSON`, is
  split at its first colon, and one whose name is not known leaves the headers unknown, #61), `@Body` (its declared
  type gives the shape, under `@SerializedName` / `@Json` / `@SerialName` / `@JsonProperty` names), `@FormUrlEncoded` with `@Field` / `@FieldMap` (a form body), `@Multipart` with `@Part` /
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
- **Names from constants** (#61): a header or query name given by a member of a class or object holding a literal
  (`header(CacheControl.SAVE, "1")`, `@Header(HeaderNames.TRACE)`, `@RequestHeader(TENANT)`: a `const val` of an
  `object` or a companion object, a Java `static final`, also statically imported) is read in every client above, as
  a literal name is (`tests/fixtures/kotlin/const-names/`, `tests/fixtures/java/const-names/`).

**Clients a DI container provides** (#46 and #75, `src/lang/jvm/di/`, the language's `injection`): a parameter or field
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
- **Holders** (#75): an injection point typed `Lazy<T>` (Dagger), `Provider<T>` (JSR-330) or `ObjectProvider<T>`
  (Spring) is read where its `get()` / `getObject()` is called: `client.get().newCall(...)` gets the binding of `T` its
  qualifiers select. A Retrofit `callFactory { request -> client.get().newCall(request) }` (also `Call.Factory { ... }`)
  is its client, as `.client(okHttp)` is, and the lambda forwarding the request is not a request of its own (nor one
  given to another library's `*.Factory { ... }`).
- **Collections** (#75, `collections.ts`): a Dagger or kotlin-inject `Set<T>` is the `@IntoSet` and `@ElementsIntoSet`
  contributions of its qualifier, or the one provider of the whole set (both: unknown); a Spring `List<T>` / `Set<T>`
  is every bean of `T`. Interceptors added from one (`apply { interceptors.forEach(::addInterceptor) }`,
  `interceptors.forEach { builder.addInterceptor(it) }`, `additionalInterceptors(list)`) each apply
  (`src/lang/jvm/elements.ts`). A contribution is never the binding of a single `T`.
- **Other types** (#75, `locators.ts`): a Spring bean of a project class is also a bean of the classes and interfaces it
  extends (`@Component class AuthInterceptor : ClientHttpRequestInterceptor` injected as the interface; two beans
  implementing it, neither primary nor named like the point: unknown). Koin `single { ... } bind Api::class`,
  `.bind<Api>()`, `.binds(arrayOf(...))` and `singleOf(::Impl) { named("x"); bind<Api>() }`; type qualifiers
  (`named<Uploads>()`, `qualifier<T>()`).
- **Injekt** (#75): `addSingletonFactory { ... }`, `addSingleton(x)`, `addFactory { ... }` in files importing
  `uy.kohesive.injekt`, looked up by `injectLazy<T>()`, `Injekt.get<T>()` and `val x: T by injectLazy()`.
- **Configuration properties** (#94, `config-props.ts`): a Spring injection point typed with a project class annotated
  `@ConfigurationProperties(prefix = "weather")` (a Kotlin class, a Java POJO or record) is the configuration it binds:
  each scalar property reads as the configuration value `weather.base-url` (the canonical kebab-case name) with the
  default the class gives it (a constructor default, a field initializer, a record component's `@DefaultValue`), as
  `@Value("${weather.base-url:...}")` does; `props.baseUrl`, `props.getBaseUrl()` and a record's `props.baseUrl()`
  read it. A class without the annotation that nothing binds stays unknown, not its default. With #100: a property typed
  with a project class (`val api: Api = Api()`, also a class nested in the properties class) is a nested group
  (`weather.api.base-url`, read by `props.api.baseUrl` and `props.getApi().getBaseUrl()`; `instanceField` reads a
  member of such an object, `src/lang/ir/instance.ts`), three levels deep at most; a `@Bean` method annotated
  `@ConfigurationProperties(prefix = "inventory")` binds the class it returns (declared or constructed; two such
  methods for one class: unknown); and the module's `application.yml` / `.properties` (as `spring-config.ts` reads
  them) gives the default of each read before the class does, a `${X:d}` in it the environment variable it names. Values are read with the scanned directory only: a read without it (a caller's argument, #39) is
  cached apart (`inject.ts`).
- **More collections** (#94): Koin's `getAll<T>()` is every definition bound to `T`; Spring's
  `ObjectProvider<T>.orderedStream()` / `stream()` every bean of `T`, and `ObjectProvider<List<T>>.getObject()` the
  injected list. Interceptors added in a `for` loop over a collection (`for (Interceptor i : interceptors)
  builder.addInterceptor(i)`, `for (i in list)`: `FunctionDef.loops`, read where one element stands for each, never
  as the variable's value; a variable reassigned in the loop is not the element), through a method reference on the
  builder (`interceptors.forEach(builder::addInterceptor)`) or by a project extension of the client builder
  (`fun OkHttpClient.Builder.addInterceptors(list: List<Interceptor>)` adding each, also by `fold(this) { b, i -> ...
  }`, read with the call's arguments) each apply. A Koin definition returning a builder variable
  (`val b = OkHttpClient.Builder(); ...; b.build()`) is a binding of what it builds.
- **Wrapped interceptors and lists built in steps** (#100, `src/lang/jvm/http/interceptors.ts`): an interceptor
  handing the request to another (`Interceptor { wrapped.intercept(it) }`, a class whose `intercept` calls
  `inner.intercept(chain)` with `inner` a constructor argument, the lambda of a project `fun interface` written in an
  extension: `fun Interceptor.toAppInterceptor() = AppInterceptor { chain -> intercept(chain) }`) has the headers of the
  one it wraps, four levels deep at most; `x.toAppInterceptor()` is the extension's one return with `x` its receiver.
  An interceptor's local helper functions (`fun withToken(r: Request) = r.newBuilder().addHeader(...)` declared in its
  provider) are its steps, and so are the project extensions of the request builder it calls as steps
  (`newBuilder().addHeaderIfNotEmpty(NAME, value)` whose body calls `header(name, value)`), read with the call's
  arguments. Lists of interceptors: `buildList { add(a); if (debug) add(b) }` (an item added in a
  branch counts), a variable made by `mutableListOf(...)`, `ArrayList<>()`... and filled with `add` / `addAll`
  (`src/lang/jvm/elements.ts`), also through parameters and providers. A builder variable given to a project function
  that is not an extension (`Interceptors.addAll(builder, list)`, a Java static helper) gets the interceptors that
  function adds, read with the call's arguments. One interceptor added on several paths (`when (x) { is A ->
  addInterceptor(...); is B -> addNetworkInterceptor(...) }`) counts once. Headers set on a builder of the response
  (`var b = response.newBuilder(); b = b.header(...)`, also in a `let` on it) are not the request's.

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

**Extension functions** (#86, `src/lang/ir/extensions.ts`): `fun S3Client.delete(b: String, k: String) { ... }` has a
receiver, `FunctionDef.receiver` (a parameter named `this` of the receiver type, kept out of `params`). In its body,
`this` and `this@delete` are that parameter, and a bare name nothing in the project declares (`headBucket(...)`, also a
function imported from the receiver's library: Ktor's `get(url)` on `HttpClient`) is a member of it (`implicit`
names), so the calls are found like those on a typed parameter. A lambda keeps that receiver where it has none of its
own (`let`, `use`, `withContext`, `runCatching`...), not in `apply`, `run`, `with` or a DSL builder lambda, nor in an
anonymous object or a local class. An extension is a member of its type, not a name: `client.delete(b, k)` runs the
extension of that name in scope (same package, imported, or a member extension in its class) whose receiver type is
the type of `client`, read from its chain (a declared type, a constructor, `X.Builder()...build()`, a static factory
such as `S3Client.fromEnvironment()`); it is then a wrapper like any other, its receiver the caller's object, so the
caller's client gives its endpoint and its interceptors. A value of no known type, or extensions of several files that
fit, run none. A wrapper whose parameter is only read in a builder lambda's properties (`DeleteObjectRequest { bucket =
name }`) is a wrapper too.

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

- DI (#94, #100): a `Call.Factory` built by hand and handed to a class, and Spring's implicit `default` profile
  (`application-default.properties` when no profile is active) are not read.
- Optional client parts (#69): a client default set in a branch (`if (token != null) defaultHeader(...)`, a branch of
  Ktor's `defaultRequest { }`) and a header set on the request itself in a branch are still listed as always sent;
  an early return that sends nothing (`return Response.Builder()...build()`, a cached response) still makes the
  headers after it optional.
- A member inherited from a base class is only read through `this.x`; a bare `x` resolves to the class's own members.
- Extension functions (#86): an extension called inside `with(client) { ... }` or `client.run { ... }`, one called
  from Java (`StorageKt.delete(client, ...)`), and a builder extension used as a step (`Request.Builder().authed()`,
  `fun HttpRequestBuilder.json()` in a Ktor lambda) are not followed; an HTTP call made in a lambda of a wrapper
  (`withContext(io) { client.get(url) }`) is found where it is written, not at the wrapper's callers.
- Methods of an anonymous `object : Callback { ... }` run as closures of the enclosing code (calls in them are found,
  `this` is the enclosing class's); the anonymous object's own properties are not fields.
- A star import of an external package (`import retrofit2.http.*`) does not tell which names it provides: they stay
  unresolved, except the client classes listed in `wildcardTypes` of `clients.json` (`HttpClient` under
  `import io.ktor.client.*`, `OkHttpClient` under `import okhttp3.*`) when a single star import of the file has it,
  and the classes of the SDK registries (`DynamoDbClient` under `import software.amazon.awssdk.services.dynamodb.*`,
  `Customer` under `import com.stripe.model.*`, a request class under a star import of one of the `setters.packages`:
  `import software.amazon.awssdk.services.dynamodb.model.*`, `src/lang/ir/project.ts`). Retrofit annotations are matched by name in a file that imports `retrofit2.http`.
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
  a DynamoDB-mapped item) give no body. A builder kept in a field and filled by several methods is not read.
- Spring AI (#89, #96): a project with two model starters calling a `ChatClient` or `ChatModel` that no class,
  qualifier, `spring.ai.model.<kind>` or bean name ties to one provider gets no call there. Not read: the Vertex AI
  Gemini starter (gRPC by default, gone in 2.0), Google GenAI on Vertex AI, the other OpenAI-compatible starters
  (MiniMax, Moonshot, ZhiPu AI), the Bedrock region (the host keeps `{region}`), default models of the image and audio
  kinds and of Azure, Bedrock and Google GenAI, releases outside 1.0.0 to 2.0.1 for a value that changed, profiles
  activated outside the files (`SPRING_PROFILES_ACTIVE`, the command line), profile expressions (`!prod`, `a & b`),
  `file:` imports and a config server.
- JVM SDKs listed in `providers.json` without a registry are reported as `unsupported` in `coverage.sdks`. AWS services
  without a registry (Lambda, Kinesis, the SDK for Java 1.x's clients other than
  S3) are not in `providers.json`. The DynamoDB Enhanced Client's table name and item, and the AWS SDK for Kotlin's
  sealed-class values (`AttributeValue.S(v)`, `ConversationRole.User`), are not read.

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

## Go

**Detected:** `net/http` (`http.Get`, `http.Head`, `http.Post`, `http.PostForm` and the same methods of a
`http.Client`; requests built with `http.NewRequest` / `http.NewRequestWithContext`, with the headers, basic auth and
query parameters the function then sets on them), go-retryablehttp and the fhttp fork (the same API), Resty v2 and v3
(`resty.New()...R()...Post(url)`), and the SDKs in [`sdk-support.md`](sdk-support.md) (sashabaranov/go-openai,
openai-go, anthropic-sdk-go, google.golang.org/genai). Raw HTTP calls to any provider's host (Telegram's
`api.telegram.org/bot{token}/sendMessage`, Discord, Slack webhooks, OpenAI-compatible endpoints) are found through
`net/http` like any other.

**Resolved:** imports with and without an alias (a package used under its import path's last element, a table in
`src/lang/go/packages.json` for the others), a local hiding an import of its name, package-level and local `const` /
`var` (also of the other files of the package, and of other packages of the module through their import paths),
`+`, `+=`, `fmt.Sprintf`, `path.Join`, `url.JoinPath`, `strings.Join` of a slice literal, raw and interpreted string
literals, `os.Getenv` / `os.LookupEnv`, struct fields (typed by the declaration, valued by the project's struct literals
and by `c.field = v` in methods), method receivers, embedded structs (as base classes), function literals, parameters
and their callers' values, and calls returning several values (the first is the value, the last the error; `return
"", err` returns nothing). Struct literals are calls of their type with their fields as named arguments
(`src/lang/go/composite.ts`), so `&http.Client{}` is a client for the call chains; the language's `resolveCall`
(`src/lang/go/structs.ts`) reads one as the dict it serializes to: a project struct by its `json` tags, an SDK's
request struct by the SDK's naming (`MaxTokens` -> `max_tokens` for the OpenAI and Anthropic SDKs, camel case for
genai), with the fields set on its variable afterwards (`req.Stream = true`). Maps keep the keys set later
(`m["k"] = v`, see [#38](#keys-added-after-a-dict-is-built-38)).

**Packages:** a module name is the file's import path: the `module` of the nearest `go.mod` and the directory under
it (`github.com/acme/bot/internal/llm`, written `github_com.acme.bot.internal.llm` since the engine's roots are dotted;
registries and client tables give Go import paths, converted the same way). `packageScope` makes the files of a
directory see each other, and the language's `link` hook (run once every file is lowered) merges a type's methods
declared in other files into the class of its declaration and gives struct fields the values of the project's struct
literals (`src/lang/go/link.ts`).

**Manifests:** the `require` directives of `go.mod` (single and block form, `// indirect` aside) with their versions;
a module path is the prefix of its packages' import paths, so `importRoots` needs no table. A registry of a module
with several major versions lists them in `majorVersions` (`["v2", "v3"]`): one entry per module path, so a call names
the module the code imports (`github.com/openai/openai-go/v3`) and coverage counts it there.

**Out of scope by default:** `vendor/`, `testdata/`, `*_test.go`.

**How the open issues apply:** #3 (no-crash scans: per-file parse and internal errors; a file ending without a newline
is repaired), #4 (the same diagnostics as the other tree-sitter languages; parameters are typed, so one whose type names no
client is not an `injected-client`), #5
(`tests/fixtures/go/**/expected.json` in the recall check, and a multi-package module checked by `tests/go.test.ts`),
#6 and #7 (Go module paths per provider in `providers.json`, `ecosystem: "go"`), #8 (env reads, constants, struct
fields), #37 (does not apply: parameters are typed), #38 (map keys), #39 (callers' values).

**Limitations:**

- Interfaces are not followed: a client held in an interface-typed field or parameter has no known implementation.
  Generics, channels, goroutines' results and reflection are not read.
- A function returning a value from several `return`s (a URL helper with a fallback) is not followed for a URL, as in
  the other tree-sitter languages; a helper with one `return` is.
- Headers set on a request by another function (`setHeaders(req)`) are not read; a request built and sent in different
  functions is reported where it is built.
- A package whose name is not its import path's last element (without `go-` / `-go` or a major version) and that is
  imported without an alias is not recognised, unless `packages.json` lists it.
- A struct literal reads as its JSON: a field renamed by its tag (`BaseURL string `json:"base_url"``) is not found
  when the code reads `cfg.BaseURL` of that literal.
- go-openai's Azure configuration (`DefaultAzureConfig`: deployment paths, `api-version`), genai's Vertex AI backend
  and `HTTPOptions.BaseURL`, openai-go's Azure middleware, and options given in a slice (`opts...`) are not modelled.
  Resty path parameters stay as placeholders. The go-telegram-bot-api SDK has no registry yet (its raw HTTP calls are
  found; `bot.Send(msg)` is not).

## Shell

**Detected:** curl, wget and HTTPie (`http` / `https`) command lines in shell scripts: `.sh`, `.bash` and `.zsh` files,
and files with no extension whose first line is a `sh`, `bash`, `zsh` or `dash` `#!` line (`bin/deploy`). Commands are
read wherever they run: in pipelines, conditions, functions, `$(...)` and backticks; text that only names a command is
not (comments, strings such as `echo "curl ..."`, heredocs, aliases). Runners in front of the program are dropped
(`sudo`, `env A=1`, `timeout 30`, `command`, `exec`, `nohup`, `time`, `nice`), and a program kept in a variable is
read (`CURL="curl -fsS"; $CURL "$URL"`).

| client | what is read |
|---|---|
| curl | the URL (each non-option argument that reads as a URL, or `--url`; at most five), `-X` / `--request`; `-d` / `--data` / `--data-raw` / `--data-binary` / `--data-urlencode` / `--json` / `-F` / `--form` imply POST, `-G` sends the data as the query, `-I` / `--head` is HEAD, `-T` / `--upload-file` PUT; `-H` / `--header` (also `-A`, `-e`, `-b name=value`), `-u` / `--user` (basic), `--oauth2-bearer`; `--url-query`; short options in clusters (`-sSL`, `-XPOST`) |
| wget | the URL, `--method`, `--post-data` / `--body-data`, `--post-file` / `--body-file`, `--header`, `--user-agent`, `--user` / `--http-user` (basic), short options in clusters (`-qO-`) |
| HTTPie | `http` / `https [flags] [METHOD] URL [items]`: `Header:value`, `name==query`, `field=text`, `field:=json`, `field@file` (multipart), `--form` / `-f`, `--multipart`, `-a` / `--auth` with `-A` / `--auth-type`; `:3000/path` is localhost |

**Resolved:** a variable the file assigns (`BASE="https://..."`, `export`, `readonly`, `local`, `declare`) is a constant
(`hostKind: "const"`); `$X` / `${X}` with no assignment in the file is an env read (`hostKind: "env"`, `envName: "X"`), and
`${X:-https://default}` gives the default as the host with the env var's name. When a name is assigned several times,
an assignment in the same function before the use wins, then the top-level one that says the most: a value over one
reading the name itself (`X=${X:-default}`), over option parsing (`X="$2"`, `X=$OPTARG`), over an empty initialisation
(`X=""`), which reads as unassigned. `${X%/}` drops a trailing slash; other parameter expansions read as the variable.
Arrays (`HEADERS=(-H "a: b")`, `"${HEADERS[@]}"`) are expanded; a value read at run time is a placeholder named after
its variable (`ID=$(jq -r .id f)` gives `{ID}`, origin `call`), a loop variable is a parameter. A file sourced with a
path the scan can read (`source ./config.sh`, `. "$(dirname "$0")/env.sh"`, next to the script or at the root) gives its
top-level values to the env reads of the script, one level deep (`src/lang/shell/sourced.ts`). An unquoted value the
scan cannot read is split into words by the shell, so it holds options as often as a URL: `curl $CURL_OPTS "$API/v1"`
takes `"$API/v1"` as the URL, `curl $URL` takes `$URL`.

**Bodies:** a JSON document written in the script is read as JSON with the shell values in it
(`-d '{"text": "'"$MSG"'", "n": '$N'}'`: `text` a string, `n` a dynamic value); `a=1&b=$X` data and `-d a=1 -d b=2`
are form data (`--json` values are joined as they are, `-d` values with `&`); `-F` fields are multipart (a file field is a
string); `<...>` is XML; `-d @payload.json` reads a JSON file next to the script, any other file is an unknown body
(`bodySource: "unknown"`). A literal `Content-Type` header gives the encoding of a body the scan cannot read
(`-d "$PAYLOAD"`).

**Wrappers:** a function whose request reads its arguments (`api() { curl -H "$AUTH" "$BASE/$1" "${@:2}"; }`) is
also reported at each of its calls in the file, `via: "wrapper:api"`, with the arguments read there (`api repos/x -X
POST` is a POST). A `case "$1" in get) ...` or `if [ "$1" = post ]` around the command is decided by the call's
arguments. A function named like a client (`curl() { command curl --retry 3 "$@"; }`) is what a plain `curl` runs.
`--no-wrappers` turns the expansion off.

**Out of scope by default:** `vendor/`, `tests/`, `test/`, `testdata/`, `__tests__/`, `*_test.sh`, `test_*.sh`,
`*.test.sh`, virtualenvs (`.venv/`, `venv/`, `site-packages/`, `.tox/`) and the Maven and Gradle wrappers (`mvnw`,
`gradlew`).

**Parse errors:** the grammar is bash's. What it cannot read (an `ERROR` node, often zsh-only syntax) is left out and
the rest of the file is read; a file of which more than half is unread is a `parse-error` in `diagnostics.skipped`.

**Limitations:**

- No shell is run: `eval`, `bash -c "..."`, `sh -c '...'`, `xargs curl`, commands in heredocs fed to a shell
  (`ssh host <<EOF`) and curl config files are not read (a curl whose URL is only in its `-K` config is reported with an
  unknown host and `optionsOpaque`).
- Wrapper expansion is one level and within one file: a wrapper called from another wrapper, or defined in a sourced
  file, is reported where it is written with its arguments as placeholders (`{arg1}`). Options the scan cannot read
  (`"$@"` with no call site, `"${OPTS[@]}"` of an unknown array) make the call `optionsOpaque`.
- Shell variables are dynamic: a value assigned in several places reads as one of them (see **Resolved**), and a value
  from a file the script does not source by a readable path (a `.env` the repository does not hold) is an env read.
- curl's URL globbing (`[1-10]`, `{a,b}`), `--next`, `--variable` / `--expand-*` and `--config` files are not modelled.
- Shell scripts have no package manifest: they add no `coverage.sdks` rows.
## Rust

**Detected:** reqwest, async and blocking (`reqwest::get(url)`; a `Client`'s `get` / `post` / `put` / `patch` /
`delete` / `head` / `request(method, url)` with the steps after it, sent by `send()`), ureq 2 and 3 (the crate's and an
agent's verbs, sent by `call()` or a `send_*` method), awc, surf (sent by `send()` or a `recv_*` method) and isahc's
verb functions; and the SDKs in [`sdk-support.md`](sdk-support.md) (async-openai, openai-api-rs, teloxide, serenity).
Raw HTTP calls to any provider's host (Anthropic, Gemini, OpenAI-compatible endpoints, Telegram, Slack webhooks) are
found through those clients like any other.

**Requests built in steps** (`src/lang/rust/requests.ts` over `requests.json`): a request starts with a verb call
(`starts`), takes steps (`steps`: `header`, `bearer_auth`, `query`, `json`, `form`...) and is reported at the call
that sends it (`sends`), the calls between them read with the engine's builder steps (`ir/steps.ts`, `fluentChains`):
through variables, fields, the project's functions returning a builder and the branches of a `match` or an `if`. A
request whose branches start at one verb call is one request (the headers only some branches set are optional);
branches with different starts are alternatives. The client builder's `default_headers` and `user_agent` are the
client's parts. A start must be the crate's (its chain rooted in `reqwest`, `ureq`...), so a `send()` on a channel or
a `get()` on a map is not one. One-shot functions (`reqwest::get(url)`, isahc's) are a client table (`clients.json`).

**Resolved:** `use` declarations (aliases, lists, `self`, globs), `crate::` / `self::` / `super::` paths, `pub use`
re-exports, external crates named by path without a `use` (Rust 2018), `const` and `static` items, `impl` blocks
(methods and associated constants: `Self::BASE`), struct fields (typed by the declaration, valued by the project's
struct literals and by `self.x = v` in methods), parameters and their callers' values, closures, `match` and `if`
values (a binding of `Some(x)` / `Ok(x)` is the matched value), `let` with types, `+`, `+=`, `push_str`. Macro
arguments are tokens to tree-sitter: `format!`, `concat!`, `env!`, `option_env!`, `vec!` and `lazy_static!` are parsed
again as Rust (`src/lang/rust/reparse.ts`, positions mapped back to the file), `serde_json::json!` is read from its
tokens (`json-macro.ts`), other macros written like calls have their arguments lowered for the calls they hold
(logging and assertion macros aside). Conversions and error handling stand for their value at lowering
(`calls.ts`: `.clone()`, `.to_string()`, `.into()`, `?`, `.await`, `.unwrap()`, `.expect(..)`, `.map_err(..)`,
`Arc::new(x)`, `Some(x)`, `String::from(x)`, `Url::parse(x)`, `HeaderValue::from_str(x)`), defaults are `or` values
(`.unwrap_or(d)`, `.unwrap_or_else(|_| d)`), environment reads are `env` values (`std::env::var`, `dotenvy::var`), and
`Lazy::new(|| v)` / `LazyLock::new(|| v)` are `v`. Struct literals are calls of their type with named arguments
(`struct-expr.ts`); the language's `resolveCall` (`structs.ts`) reads one as the dict serde sends (a project struct by
its `#[serde(...)]` names, an SDK's as written), async-openai's `...Args::default()...build()` builders, configs
(`OpenAIConfig::new().with_api_base(u)`) and messages, openai-api-rs's request constructors, and a project function
returning one struct literal (`Settings::default()`).

**Modules:** a module's name is its path in its crate, dotted: the crate's name (`[lib] name`, else `[package] name`
of the nearest `Cargo.toml`, `-` as `_`), then the directories under `src/` and the file (`mod.rs`, `lib.rs`,
`main.rs` name their directory); `src/bin/*.rs` and `examples/*.rs` are crate roots of their own. Paths are made
absolute while lowering (`paths.ts`), so the index resolves `crate::config::BASE_URL` and the crates of a workspace
(`my_core::llm::Client`) like any import. An inline `mod x { ... }` is a class of its file (its constants are fields,
its functions associated functions), so `x::API` and `crate::m::x::API` read. The language's `link` hook moves the
methods of an `impl` written in another module than its `struct` to the declared class and gives struct fields the
values of the project's struct literals (`link.ts`).

**Manifests:** `Cargo.toml`'s `[dependencies]` and `[target.'...'.dependencies]` (dev and build dependencies aside),
with versions; `x.workspace = true` reads the workspace's `[workspace.dependencies]`, and a renamed dependency
(`tg = { package = "teloxide" }`) counts under its crate. Crate names are written lower case with `-`
(`normalizeCrate`); a crate's code name is its name with `_` (`async_openai`), so `importRoots` needs no table.

**Out of scope by default:** `target/`, `vendor/`, `tests/`, `benches/`, `build.rs`, and the files unit tests are
kept in by convention (`tests.rs`, `*_tests.rs`, `*_test.rs`); `#[cfg(test)]` items and `#[test]` functions are
skipped while lowering, and the file a `#[cfg(test)] mod x;` declares is read for its names but gives no call
(`link.ts`). `examples/` is read, as in the other languages.

**How the open issues apply:** #3 (per-file parse and internal errors; a file using syntax the grammar does not know
yet, `&raw` as a variable or an attribute on a pattern's field, is repaired in place, `repair.ts`; a macro whose input
does not parse is left unread), #4 (the same diagnostics as the other tree-sitter languages; parameters are typed), #5
(`tests/fixtures/rust/**/expected.json` in the recall check, a workspace of two crates and a negative fixture checked
by `tests/rust.test.ts`), #6 and #7 (crates.io names per provider in `providers.json`, `ecosystem: "cargo"`), #8 (env
reads with defaults, constants, struct fields, `Lazy` statics), #37 (does not apply: parameters are typed, but a
`Client<AzureConfig>` parameter is read from its callers), #38 (`body["k"] = v` on a `json!` value, `insert` on maps),
#39 (callers' values).

**Limitations:**

- Traits are not followed: a client behind `dyn Trait`, `impl Trait` or a generic bound has no known implementation;
  a trait's default methods are not read.
- Macros other than those listed are not expanded: a `macro_rules!` that builds requests, and requests written inside
  a `{ ... }` macro (`tokio::select! { ... }`), are not read.
- Requests kept in data structures and sent by shared code (`RequestData { url, body }` built per provider, sent by
  one function) are reported where they are sent, with what that function sees.
- A function returning a value from several `return`s (a URL helper with a fallback) is not followed for a URL, as in
  the other tree-sitter languages; values read from configuration files (`config.url` deserialized from TOML) are
  unknown, `#[serde(default = "...")]` included.
- A renamed dependency's code name (`openai = { package = "async-openai" }`, used as `openai::`) is not matched with
  its registry. Two crates of a workspace with the same name, and a module of the project named like an external
  crate it also uses, can be confused.
- async-openai's `AzureConfig` deployment paths, and setters chained after a teloxide method (`.parse_mode(...)`) are
  not read; serenity's ids come from the gateway and stay placeholders. hyper and the Anthropic and Gemini crates (none
  dominates: `anthropic-sdk`, `misanthropy`, `clust`, `google-generative-ai-rs`, `gemini-rs` are listed in
  `coverage.sdks` only), rig and genai (routing by model), octocrab and slack-morphism have no registry yet.

## Dart

**Detected:** package:http (`http.get` / `post` / `put` / `patch` / `delete` / `head` / `read`, prefixed or not, a
`Client`'s methods; `http.Request` and `http.MultipartRequest` reported where they are built, with the headers,
body, fields and files the function then sets on them: `src/lang/dart/requests.ts`), Dio (an instance's verb, `*Uri`
and `request` calls with `data:`, `queryParameters:` and `options: Options(...)`, the `BaseOptions` of its
construction, and the options and interceptors set on it afterwards: `dio.ts`), and supabase_flutter / supabase
(`registry/supabase-flutter.json`: tables, rpc, auth, storage, functions; the base URL of `Supabase.initialize(url:
...)`). Raw HTTP calls to any provider's host (OpenAI, Gemini, payment APIs) are found through those clients.

**Grammar:** the npm `tree-sitter-dart` release (1.0.0, 2023) is built for an older tree-sitter and does not load in
web-tree-sitter 0.27, so the grammar ([UserNobody14/tree-sitter-dart](https://github.com/UserNobody14/tree-sitter-dart),
MIT) is built from its source at a pinned commit by `pnpm gen:dart-grammar` (`scripts/gen-dart-grammar.ts`: a shallow
fetch of the commit, then `tree-sitter build --wasm` with the `tree-sitter-cli` dev dependency, which pins the wasi-sdk
and binaryen it compiles with, so the same commit gives the same bytes; no Docker or emscripten needed). The result,
`src/lang/dart/tree-sitter-dart.wasm`, and the grammar's license are committed; `BUILT_GRAMMARS` in
`src/lang/grammars.ts` names it, the build copies it to `dist/grammars/` with the others, and from source it is read
where it is. To move to a newer grammar, change `DART_GRAMMAR_COMMIT` in the script and run it.

**Lowering:** the grammar writes a postfix chain flat: `a.b(c)[d]` is the primary `a` followed by sibling `selector`
nodes, and a cascade (`a..b()..c = v`) by `cascade_section` siblings. `lower-expr.ts` reads a container's named
children as runs (a primary and the selectors after it) and folds each into the IR (`attr`, `call`, `index`); a
cascade's sections are calls and member sets on the receiver, its value the receiver. Top-level declarations are
siblings too (`function_signature` then `function_body`, a type then a declaration list), read in order
(`lower.ts`). Strings keep their text between the quote, escape and substitution nodes (`literals.ts`: raw, multi-line
and adjacent strings). Classes (`lower-class.ts`): the unnamed constructor is `<init>` (its `this.x` parameters and
initializer list set fields; field initializers run there too), a named constructor or factory a static method
returning an instance, a getter a method read as a property whose return is also a field value; `extends` and `with`
give the bases. A bare name that is a member of the class reads as `this.name`. Environment reads and `Uri.parse` are
values at lowering (`calls.ts`); the language's `resolveCall` (`resolve.ts`) reads Dio's `BaseOptions(...)` /
`Options(...)` as dicts, `Uri.https(host, path, query)` and `Uri(...)` as the URL they make (the query map written into
it), and a project helper returning one map. The `injection` hook (`inject.ts`) gives a constructor's parameter the
argument of the class's one construction in the project, a Riverpod read (`ref.watch(p)`) what `Provider((ref) =>
...)` returns, and a get_it lookup (`getIt<T>()`) what the one `register*<T>(...)` of that type builds.

**Libraries:** a library's name is its package's (`name:` of the nearest `pubspec.yaml`) and its path under `lib/`, as
`package:` imports name it; a file outside `lib/` keeps its directory, marked (`<package>.@bin.tool`); relative
imports name the file they point to. Imports with a prefix are names of the file. Imports without one, exports and
parts are resolved by the `link` hook once every file is lowered (`link.ts`): a library exports its declarations, its
parts' and what it `export`s (`show` / `hide` applied), and each such name of a project library becomes an explicit
import of the importing file, so a lookup never searches every import. A package outside the project is named by its
package (`package:dio/dio.dart` is `dio`): its classes are reached through `wildcardTypes` (`dio.Dio`, `http.Client`)
or a registry's imports (`supabase_flutter.Supabase`).

**Manifests:** `pubspec.yaml`'s `dependencies` with their versions (a map's `version:`; `sdk:`, `path:` and `git:`
dependencies have none), dev dependencies and overrides aside. Package names are lower case with `_`
(`normalizePub`), and a package's import root is its name. `providers.json` lists pub packages for Supabase, Firebase,
Stripe, OpenAI, Anthropic, Gemini, Sentry, RevenueCat, PostHog, Mixpanel, Google Maps, Mapbox and Algolia, so
`coverage.sdks` lists them (`ecosystem: "pub"`), unsupported but for supabase_flutter.

**Out of scope by default:** `test/`, `integration_test/`, `test_driver/`, `*_test.dart`, `.dart_tool/`,
`.pub-cache/`, `.fvm/` and generated code (`*.g.dart`, `*.freezed.dart`, `*.mocks.dart`, `*.gr.dart`, `*.config.dart`,
`generated_plugin_registrant.dart`).

**How the open issues apply:** #3 (per-file parse and internal errors), #4 (the same diagnostics as the other
tree-sitter languages; parameters are typed), #5 (`tests/fixtures/dart/{http,dio,negative}/expected.json` in the
recall check; a package with `lib/`, a barrel library, parts, a second package and out-of-scope files checked by
`tests/dart.test.ts`), #6 and #7 (pub packages per provider in `providers.json`, `ecosystem: "pub"`), #8 (environment
reads with defaults, constants, static members, getters), #37 (does not apply: parameters are typed), #38 (`m['k'] = v`
on a local map), #39 (callers' values).

**Limitations:**

- dart:io's `HttpClient` (`getUrl` / `postUrl`, then `request.close()`), `GetConnect`, Chopper services and
  retrofit.dart's annotated interfaces are not read (their generated `*.g.dart` code is out of scope).
- A Dio instance's options are read from the class or function that holds it: options or interceptors set by a caller
  on an instance passed in, or through a getter of another object, are not.
- A constructor parameter is followed only when the project builds the class once; a function's parameters read
  their callers' literal values only (#39), as in the other tree-sitter languages.
- Extension methods (`extension X on Dio`), enhanced enums' fields (`Env.prod.baseUrl`), records, patterns and
  `switch` statements' bodies as values are not followed; a `switch` expression reads as a host table, like a Rust
  `match`.
- Riverpod code generation (`@riverpod` functions, whose providers are in `*.g.dart`) and injectable's generated
  registrations are not read; a get_it registration is matched by its type argument or the class it builds.
- Firebase, Stripe and the other pub SDKs listed in `providers.json` have no registry yet: `coverage.sdks` lists them
  as `unsupported`.

## JavaScript and HTML

**Detected:** everything the TypeScript front end detects (fetch, axios, got, ky, node http, SDK registries, the AI
SDK, framework helpers), plus jQuery (`$.ajax`, `$.get`, `$.getJSON`, `$.post`) and `XMLHttpRequest`
(`open` + `setRequestHeader` + `send`); in HTML pages, inline scripts and `<form action>` submissions; in Vue, Svelte
and Astro components (`.vue`, `.svelte`, `.astro`), the `<script>` blocks (`<script setup>`, `<script
context="module">`) and an Astro component's `---` frontmatter, read as TypeScript at their positions in the file
(`src/lang/html/components.ts`; `location.language` is `typescript`, and `--language typescript` reads them).

**Resolved:** as in TypeScript, plus CommonJS exports (`const { BASE } = require("./config")`,
`config.base` with `module.exports = {...}`), `require("stripe")(key)`, fields assigned in any method
(`this._stripe = new Stripe(key)` in `configure()`), and in HTML, template tags as dynamic values.

**Out of scope by default:** `*.min.js`, `*.bundle.js`, `*.chunk.js`, files with a line over 2,000 characters in their
first 8 KB, `vendor/`, `bower_components/`, `coverage/`, `.nuxt/`, `.output/`, `.svelte-kit/`, test and spec files
(`*.test.ts`, `*.spec.ts`, `*.e2e-spec.ts`, `__tests__/`, `__mocks__/`, `__testfixtures__/`, `test/`, `tests/`,
`integration_test/`, `integration_tests/`, `cypress/`), test runner configuration and setup files (`jest.config.*`,
`jest.setup.*`, `vitest.config.*`, `vitest.setup.*`, `vitest.workspace.*`, `playwright.config.*`, `karma.conf.*`,
`setupTests.*`): an SDK they import is not counted as imported in `coverage.sdks`.

**Limitations:** the templates of components (`{#await fetch(...)}`, `@click="..."`, an Astro `{...}` expression) and
other template formats (`.ejs`, `.hbs`) are not read; imports of a component's script resolve as a TypeScript file's
do (SvelteKit's `$lib` only through the tsconfig paths the repository has); event-handler attributes
(`onclick="..."`) are not; a form whose action is a template tag is skipped (its target is the app's own
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
  /** GraphQL only (#56): the arguments of selected fields by path: { "orders": { "first": 10, "after": "$cursor" } } */
  arguments?: Record<string, Record<string, unknown> | Record<string, unknown>[]>;
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
  registry entry names the argument holding a GraphQL document (`documentArg`), and a JSON-RPC client library's
  method, whose front end sets the RPC method it sends (`rpc` / `rpcArg`, #52).

| protocol | issue | status |
|---|---|---|
| JSON-RPC (body `method`) | #34 | done: envelope, batch, helpers, branches, computed names (TypeScript, JavaScript, Python, PHP; Kotlin once its HTTP clients land, #32); client libraries (#52): `@solana/web3.js`, `@solana/kit`, viem, ethers, web3.js (TypeScript, JavaScript), web3.py and solana-py (Python); contract objects (ethers, web3.js, viem, web3.py), web3.py properties, ethers vendor providers and `@solana/spl-token` (#78); cached and context clients, wagmi, `useConnection()`, TypeChain factories, `connect` / `attach`, typed contracts and JSON ABIs (#85); app React contexts, context objects as untyped parameters, injected factories, memoized and ConnectKit wagmi configs, Python dict caches (#98) |
| GraphQL (document: type, name, fields) | #35 | done: documents in bodies, `?query=`, batches, persisted queries, `gql` tags, `.graphql` imports, Octokit (TypeScript, JavaScript, Python, PHP); client libraries (#54): Apollo Client, urql, graphql-request (TypeScript, JavaScript) and `gql` (Python); codegen AST documents and `print()` (#56, TypeScript, JavaScript); Relay and Shopify's clients (TypeScript, JavaScript), `sgqlc` and ShopifyAPI (Python, #67); Hydrogen, Relay containers, `QueryRenderer` and `loadQuery` (TypeScript, JavaScript), `sgqlc` helpers and endpoint parameters (Python, #83); the Hydrogen cart, `useQueryLoader` and Relay fragment refetch and pagination hooks (TypeScript, JavaScript, #92); `useQueryLoader` variables, Hydrogen 2026.4 cart methods and the 2026.10 storefront client and cart query (TypeScript, JavaScript, #102); bound diagnostics (#55, `diagnostics.unfollowed` `graphql-limit`); literal arguments of selected fields (#56, every language) |
| SOAP (`SOAPAction`, `soap:Body`), action-style (`Action=`, `method=`) | #36 | done for requests the code builds (TypeScript, JavaScript, Python, PHP), XML bodies as `xml`; SOAP client libraries (#58): PHP `SoapClient`, zeep (Python), node-soap (TypeScript, JavaScript); JAX-WS / Spring-WS not yet |

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
- **Client libraries** (#52) hide the envelope: registries of the `json-rpc` provider (`anyHost`, as for GraphQL
  clients: a call's provider is the one its URL names) map each client method to the RPC method it sends, `rpc` in
  the registry, which is the call's `operation` (`from: body`): `getParsedTransaction` sends `getTransaction`,
  `readContract` `eth_call`; a method that sends one of several (a block by number or by hash, a write signed locally
  or by the node) lists them, giving `alternatives`. A generic transport method names the argument holding the method
  (`rpcArg`: ethers `send(method, params)`, viem `request({ method, params })`, web3.py `provider.make_request`),
  read like a body's `method`, also through a helper's callers. `src/detect/registry/solana-web3.json` (also
  `@solana/kit`: `createSolanaRpc(url).getBalance(a).send()`, reported at the method call), `viem.json`,
  `ethers.json`, `web3.json`, `src/lang/python/registry/web3.json` and `solana.json`. The method is `POST`, the path
  the URL's; the body is the method's options object when it takes one (viem), else none (positional arguments are
  mapped to `params` by each library).
  - **Endpoint**: the client's URL (`new Connection(url)`, `new JsonRpcProvider(url)`, `createSolanaRpc(url)`, `new
    Web3(url)`, solana-py `Client(url)`), or the HTTP transport handed to it (viem `transport: http(url)`, one of a
    `fallback([...])` or several, which leaves the host unknown; `new Web3(new HttpProvider(url))`; web3.py
    `Web3(HTTPProvider(url))`). `clusterApiUrl("devnet")` reads as `https://api.devnet.solana.com`
    (`src/resolve/library-urls.ts`).
  - **HTTP only** (`src/detect/rpc-endpoint.ts`): these libraries also talk to a browser wallet (`new
    BrowserProvider(window.ethereum)`, v5 `Web3Provider`, viem `custom(window.ethereum)`, `new Web3(window.ethereum)`
    or `Web3.givenProvider`) and over sockets (`WebSocketProvider`, `webSocket()`, `IPCProvider`), which are no HTTP
    request of the app. `endpoint.nonHttp` lists those constructions; a call is reported only when its client reads as
    HTTP: a client whose transport is one of them, or is not readable, or `new Web3(x)` with an `x` that is not a URL
    string, gives no call. In Python, a client built with no provider (`Web3()` looks for a local socket first) or a
    socket provider gives none, an unreadable provider an unknown host.
  - **A call that names no client** (a typed parameter, `endpoint.types` such as `Provider` or `PublicClient`; a
    receiver of another type, `token: Contract`, is not one) uses the project's client when it builds exactly one,
    else an unknown host; it gives no call when the project builds a wallet or socket client of that library, or no
    client at all while the library has wallet clients (TypeScript; Python keeps such calls with an unknown host).
  - **Contract objects** (#78): the ABI names a contract's functions, so a registry key holds `*` for one (`Contract.*`,
    `methods.*.call`, `getContract.read.*`, `eth.contract.functions.*.call`), never one of the object's own members
    (`notFunctions`: `connect`, `interface`, `on`). The call says what it sends where it can: web3.js `.call()` /
    `.send()` / `.estimateGas()`, viem `.read` / `.simulate` (`eth_call` through the public client of `client`) and
    `.write` (a transaction through its wallet client), ethers `.staticCall()`, `.estimateGas()`, v5 `callStatic`,
    `queryFilter` (`eth_getLogs`), web3.py `.call()`, `.transact()`, `.estimate_gas()`, `caller`, event `get_logs`. An
    ethers function called directly (`token.balanceOf(owner)`, `src/detect/rpc-contract.ts`) sends `eth_call` for a
    view and a transaction otherwise: the ABI written in the code says which (human-readable signatures or JSON
    fragments, also through `new Interface(abi)` / `parseAbi`, `src/detect/contract-abi.ts`), and the runner who
    signs (`endpoint.signers`): a provider only reads (a transaction through it throws, no call), `new Wallet(key,
    provider)` signs in the app (`eth_sendRawTransaction`), `provider.getSigner()` has the node sign
    (`eth_sendTransaction`); an ABI or a runner the scan cannot read lists what it may send as `alternatives`. A
    contract on a browser wallet's provider or signer, or on no runner, gives no call; one on a runner the scan does
    not follow (a parameter, a helper's result) uses the project's one client as a typed call does.
  - **The contract's function** stays in `sdk.chain` (`Contract.balanceOf`, `eth.contract.functions.balanceOf.call`):
    `operation.name` is the RPC method on the wire, as for every JSON-RPC call, and no new report field is needed.
  - **Properties** (#78): web3.py attribute reads that send a request (`w3.eth.block_number`, `chain_id`,
    `gas_price`, `accounts`, `max_priority_fee`, `syncing`, `net.version`, `client_version`) are `property` entries;
    the Python lowering records reads of those names (`FunctionDef.reads`) as calls without arguments, which match
    property entries only (`w3.eth.get_balance` handed over as a function sends nothing).
  - **Node vendors** (#78): ethers' `InfuraProvider`, `AlchemyProvider` and `QuickNodeProvider` build their URL from
    the network (`endpoint.clients.*.vendor`, the hosts copied from ethers 5.7 and 6.13, `src/detect/rpc-vendor.ts`);
    a network the table does not list or the scan cannot read keeps the vendor's domain (`{network}.infura.io`).
    `getDefaultProvider(url)` is a JsonRpcProvider, `getDefaultProvider("mainnet")` spreads requests over several
    vendors (unknown host). `providers.json` names Infura, Alchemy, QuickNode and Helius by their domains, for raw HTTP
    calls too.
  - **`@solana/spl-token`** helpers taking a Connection first (`getAccount`, `getMint`, `transfer`, `mintTo`), with
    the project's one Connection for a typed parameter (`endpoint.clientPackage`).
  - **Cached clients** (#85): a helper that returns a cache entry it fills (`getProvider(chainId)` returning
    `providers[chainId]`, `cache.get(key)` after `cache.set(key, client)`, `??=`) hands out every client written into
    that cache (`src/detect/client-cache.ts`: the helper's returns, the variables they go through with their
    assignments, `??`, `||`, conditionals; `Callee.cached` keeps them for a call made on the helper's result). The call
    goes to their endpoint when they all agree on it, else to an unknown host (`src/detect/rpc-cache.ts`): a client built
    with a URL picked by the same run-time key (`new JsonRpcProvider(urls[chainId])`) does not take the table's first
    URL. A wallet among them gives no call; a provider class of the app counts as an HTTP client when it extends one
    (its URL is not read: it may send elsewhere) or extends a base class and builds only HTTP clients; any other value
    leaves the call as before (a runner not followed).
  - **Context clients** (#85): a client held in an object (`const services = { rpc: new JsonRpcProvider(url) }`, then
    `services.rpc.getBlock(...)`, `src/detect/callee.ts`); `@solana/wallet-adapter-react`'s `useConnection()` hands
    out the `Connection` its `<ConnectionProvider endpoint={...}>` builds: the endpoint of the project's one such
    element, else unknown (`endpoint.clients.*.component`, `src/detect/rpc-config.ts`;
    `solana-wallet-adapter.json` has the methods of `solana-web3.json` on `connection`).
  - **wagmi** (#85, `wagmi.json`, also `@wagmi/core`): actions taking the config first (`readContract(config, {...})`,
    `getBalance`, `waitForTransactionReceipt`), hooks (`useReadContract`, `useBalance`, `useBlockNumber`,
    `useWaitForTransactionReceipt`; a `config` option, else the config the app gives `<WagmiProvider config>`
    (`endpoint.contextProvider`: one built by another library is not read, no call), else the project's one config)
    and the client of
    `usePublicClient()` / `getPublicClient(config)` (`endpoint.clients.*.config`) send through the config's transports:
    `createConfig({ transports: { [chain.id]: http(url) } })` or its `client({ chain })` method, read through object
    literals, functions, spreads and reassigned variables (`deep`); RainbowKit's `getDefaultConfig` without transports
    uses wagmi's default HTTP ones (`defaultHttp`, host unknown). One transport per chain leaves the host unknown, a
    wallet's transport (`custom`, `unstable_connector`) or a socket gives no call. Writes (`writeContract`,
    `sendTransaction`, `useWriteContract`) are signed and sent by the connected wallet and are not listed.
  - **Contracts reached in other ways** (#85): TypeChain's `Token__factory.connect(address, runner)` is `new
    Contract(address, abi, runner)` (`src/detect/typechain.ts`; by the `__factory` name, so a factory generated at build
    time and missing from the repository still counts; the factory's `abi` when its file is there);
    `contract.connect(signer)` and `contract.attach(address)` are the same contract on another runner or address
    (`endpoint.rebind`, `src/detect/contract-forms.ts`); a value declared `Contract` (`token: Contract`,
    `endpoint.contractTypes`) is a contract on the project's one client whose ABI and signer are not known
    (alternatives). An ABI imported from a JSON file (`import abi from "./erc20.json"`, an artifact's `abi`,
    `require`, `src/detect/json-abi.ts`) is read within the scanned directory like a config file.
  - **Public Solana clusters**: `api.mainnet-beta.solana.com`, `api.devnet.solana.com` and `api.testnet.solana.com`
    are the provider `solana-public-rpc` (also `clusterApiUrl(...)`), named by host only: an env var such as
    `SOLANA_RPC_URL` may point at any node.
  - **Clients handed down by the app** (#98, for every SDK, not only JSON-RPC ones):
    - *React contexts*: `useContext(RpcContext)` (React 19's `use(RpcContext)`), also returned by the app's own hook
      (`useRpc()`), reads the `value` of the app's `<RpcContext.Provider>` elements (React 19: `<RpcContext value>`),
      then the property the caller reads (`const { provider } = useRpc()`); `src/detect/react-context.ts`,
      `held.ts`. Several provider elements give one client when they all hold the same construction, else their
      constructions are kept as `Callee.cached` (an RPC call agrees on one endpoint or leaves the host unknown); one
      the scan cannot read (a spread of props, no `value`) leaves the call as before. Elements are found by the
      context's name in the files (an alias of an imported context is not).
    - *Memoized values*: `useMemo(() => value, deps)` is the value (`src/ast/react.ts`), for clients, objects holding
      them and wagmi configs.
    - *Context objects given as untyped parameters*: `settle(ctx)` then `ctx.provider.getBalance(a)` follows the callers'
      argument (`{ provider }`, a variable holding such an object) one level up, as for untyped clients (#37), with
      `clientFrom: "caller"`; the manifests are not asked (`ctx.provider` says nothing of the SDK) and no
      `receiver-unknown` is listed (`Receiver.held`).
    - *Injected factories*: `constructor(private getProvider: (chainId) => Provider)` (or a constructor parameter kept
      in a field set nowhere else), then `this.getProvider(chainId)`: what the functions the class's `new` expressions
      pass return (`src/detect/injected-fn.ts`), a cache they fill read as above (every client of every function); all
      callers must pass a function the scan reads (50 callers, 8 functions at most), else the call stays as before.
    - *wagmi configs*: one memoized in a component (`useMemo(() => createConfig(...))`), one picked at build time
      (`<WagmiProvider config={isTest ? testConfig : appConfig}>`: the endpoint both agree on), and ConnectKit's
      `getDefaultConfig` (`connectkit` is an alias of `wagmi.json`), which keeps the transports it is given and
      otherwise gives each chain wagmi's default HTTP transport (checked against ConnectKit 1.9): `createConfig(
      getDefaultConfig({ transports }))`, also spread into the options (`innerConfig` in `rpc-config.ts`). A wallet
      kit whose helper is not known (another library's `getDefaultConfig`) stays unread. Transports built by an app
      helper (`transports: buildTransports(chains)`) are followed into the helper's returns.
    - *Python dict caches* (`src/lang/ir/cache.ts`): `_clients[chain_id]` or `_clients.get(chain_id)` on a module-level
      dict that the module's functions fill (`_clients[k] = Web3(...)`, `setdefault`) may be any value written into
      it; the call goes to one host only when every value agrees (`Seg.cache`, read by `irEndpoint`), a URL picked
      with the run-time key (`RPC_URLS[chain_id]`) leaves the host unknown, and a socket or wallet among them gives no
      call.
    - Not covered: wagmi v1 (`configureChains`, `useContractRead`, `readContract({...})` without a config) and its
      providers, a client given in a destructured untyped parameter (`function run({ provider })`), a client a context
      provider receives as a prop (`value={props.client}`), and a viem action handed a wagmi client from a context
      (`getEnsName(publicClient, {...})`).
- **Not covered**: JSON builders that are not literals (`JSONObject().put("method", ...)`) wait for Kotlin's HTTP
  clients (#32).

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
- **`arguments`** (#56, `src/operation/graphql-arguments.ts`) are the arguments written on selected fields, keyed by
  the field's path as in `fields` (a path that is not a leaf too: `orders(first: 10) { id }` gives `orders`), sorted.
  A literal is its JSON value: numbers (an integer past 2^53 keeps its digits as a string), strings, booleans,
  `null`, lists and input objects, an enum value its name (`CREATED_AT`); a variable is `"$name"`. Fragments are read
  where they are spread. A path aliases select with different arguments (`small: photo(size: 64) large: photo(size:
  512)`) has the list of distinct argument sets in document order, `{}` for a selection without any; one set is the
  object itself. `arguments` is absent when no selected field has arguments, so a document without any reads as
  before. Values are facts of the code, so they go through the report's redaction: a string or number under a
  credential name (`password`, `apiKey`, `input: { token }`, the names of `isCredentialKey` but `key` alone, a
  record's key in GraphQL APIs such as Shopify's `metafield(key:)`) is `<redacted>` (an
  enum value or a boolean is the schema's, kept), and a string that looks like a secret is redacted like any other.
  A computed part of a document (`` user(id: "${id}") ``, an f-string) inside a string literal is a `{name}`
  placeholder, as in templates elsewhere in the report, not the empty string (`src/operation/graphql-template.ts`
  follows the GraphQL lexer through strings, block strings and comments); outside a string it is left out as before,
  which usually leaves the document unparsed. Bounds: the walk's own (`fields`), then 500 arguments per operation,
  20,000 characters of them written as JSON and 16 levels of nested values; past one, `arguments` is left out and
  `fields` kept. `__proto__` and `constructor` are not keys.
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
  The method is `POST`. Not covered yet: `@vue/apollo-composable`, Apollo's `<Query>` components and `graphql()` HOC.
- **Relay** (#67, `src/detect/registry/relay.json`): `useLazyLoadQuery`, `usePreloadedQuery`, `useMutation`,
  `useSubscription`, `commitMutation`, `fetchQuery` and `requestSubscription`, from `react-relay` or `relay-runtime`.
  - **Endpoint**: Relay sends through the network layer its `Environment` is built with, `Network.create(fetchFn)`,
    where `fetchFn` is the app's own function. The transport is listed by its dotted name with `fetchIn`
    (`src/detect/fetch-endpoint.ts`): the URL and headers are those of the one `fetch` (also `window.fetch`,
    `globalThis.fetch`) the function sends, written in it or in a function of the project it calls (three calls deep,
    eight functions at most, each once). No `fetch` (an axios network layer, a library such as
    `react-relay-network-modern`), or several, leave the endpoint unknown.
  - **Which environment**: hooks name none, and the environment `commitMutation` / `fetchQuery` are given is the app's
    (`useRelayEnvironment()`, a prop): one the scan cannot read is the project's one environment (`contextClient` in
    the registry), as for a hook; with several, or none it can read, the host is `unknown`. Subscriptions go through
    the network layer's subscribe function: their endpoint is not read.
  - **Documents**: `graphql` tagged templates as for the other clients (a spread of a fragment defined in another
    component keeps the field it sits on), and compiled artifacts (`src/resolve/relay-artifact.ts`): a
    `__generated__/*.graphql.ts` module's `{ kind: "Request", params: { name, operationKind, text, id } }`, written as
    a literal or returned by the function the compiler calls in place, gives the text of `params.text`; a persisted
    query (`text: null` and an `id`) gives the operation's name and type from `params`, its fields left out.
  - **#83**: `loadQuery(environment, query, variables)` (the request is sent there, and reported again where
    `usePreloadedQuery` reads it); the refetch query of `createRefetchContainer(Component, fragments, query)` and the
    pagination query of `createPaginationContainer(Component, fragments, { query })` (a fragment container sends
    nothing); `<QueryRenderer environment query variables />`, a JSX element rather than a call: a registry's
    `components` list such components, their props in `props` read as the method's arguments
    (`src/detect/component.ts`). An artifact loaded with `require("./__generated__/Query.graphql")` is read from the
    scanned file it names (`export default` or `module.exports`).
  - **#92**: the `loadQuery` function `useQueryLoader(query)` returns, reported where the hook is called (its
    variables are those `loadQuery` is later given: since #102, argument 0 of each call of that function in the
    component the hook is called in, `sendsThrough.bodyArg`, `src/detect/sender.ts`; several calls give one body of
    alternatives, a function handed on gives none); the refetch and pagination of fragments
    (`useRefetchableFragment`, `usePaginationFragment`, `useBlockingPaginationFragment`,
    `usePrefetchableForwardPaginationFragment`), whose query the compiler generates for the fragment's
    `@refetchable(queryName: "...")` (`refetchQuery`, `src/resolve/relay-refetch.ts`): the artifact of that name
    (`<queryName>.graphql.ts`) when the scan has it, else the query the compiler writes, the fragment at the root of a
    `Query` fragment, under `viewer` for `Viewer`, under `node` otherwise. These hooks send only through the function
    they return (`sendsThrough`): `const [ref, loadQuery] = useQueryLoader(Q)` and `const { data, loadNext } =
    usePaginationFragment(...)` are calls, `const { data } = usePaginationFragment(...)` is none.
- **Shopify's clients** (#67) are clients of one provider: registries of the `shopify` provider (whose host,
  `.myshopify.com`, also names raw calls to `{shop}.myshopify.com` since #83) with `documentArg`,
  as Octokit's `graphql`, at `{shop}.myshopify.com` (the shop is the session's or the code's) and the path
  `/admin/api/{version}/graphql.json`, or `/api/{version}/graphql.json` for the Storefront API. The version is written
  in when the client is given one (`apiVersion: "2025-01"`), else `{version}` stays. The body is the variables.
  - `@shopify/shopify-api` (`src/detect/registry/shopify-api.json`, with the Express, Remix and React Router app
    packages as aliases): `new shopify.clients.Graphql({ session }).request(document, { variables })` and the older
    `.query({ data })` (`documentProp`: the document, or `{ query, variables }`, is `data`), the same on `Storefront`
    and on `shopify.api.clients`; `admin.graphql(document, { variables })` and `storefront.graphql(...)` from
    `authenticate.admin(request)`, `unauthenticated.admin(shop)`. The admin context is destructured from what a
    call returns (`const { admin } = await authenticate.admin(request)`): with no installed types, such a binding
    stands for the call's result and the property (`src/detect/callee.ts`, `destructuredCallee`).
  - `@shopify/admin-api-client` and `@shopify/storefront-api-client`: `request`, `fetch` and `requestStream` on a
    client their factory built (the keys keep the factory's name, so a typed parameter is not matched);
    `shopify-api-node`: `graphql(document, variables)`.
  - Python `ShopifyAPI` (`src/lang/python/registry/shopify.json`): `shopify.GraphQL().execute(query, variables)`.
  - **Clients from project code** (#83, `src/detect/callee.ts`): a factory that returns an object holding the client
    (`graphqlClient: async ({ shop }) => ({ client: new shopify.clients.Graphql({ session }), shop })`, a function, an
    arrow or a method of a local object, `clientProvider.online.graphqlClient`) gives the client to the property the
    caller destructures or reads (`const { client } = await clientProvider.online.graphqlClient(...)`); a class
    keeping the client it is given in a field (`this.client = client`) is followed through the `new` expressions of
    the class (`src/detect/receiver.ts`, see #37 below).
  - **Hydrogen** (#83, `src/detect/registry/hydrogen.json`): `storefront.query(document, { variables })` and `mutate`
    (Storefront API, `/api/{version}/graphql.json`), `customerAccount.query` and `mutate` (Customer Account API,
    `shopify.com/{shopId}/account/customer/api/{version}/graphql`). Route handlers get these clients from the request's
    context (`context.storefront`, `{ context: { storefront } }`, a helper's `storefront: Storefront`), not from an
    import: the registry lists them in `contextClients`, and in a file whose manifests declare `@shopify/hydrogen` a
    value of that name read from anywhere, with the method after it, is the key (`ReceiverResolver.contextCall`,
    `clientFrom: "manifest"`). The store is the one `createStorefrontClient` is given: the host stays
    `{shop}.myshopify.com`. #92 adds the cart handler (`createCartHandler`, `context.cart.addLines(lines)`,
    `updateLines`, `removeLines`, `updateDiscountCodes`, `get()`...): Storefront API operations whose document the
    library writes (`document` in the registry, with the operation names of Hydrogen 2025.1: `cartLinesAdd`,
    `CartQuery`; the cart's own fields are the project's fragment, so `cart` stays a leaf), the method's argument
    under its variable (`{ lines }`). `addLines` and the other updates send `cartCreate` instead when there is no cart
    yet: the report names the method's own operation. A context client's name read from a variable the code fills
    itself (`const cart = new Map()`) is not the framework's.
  - **Hydrogen after 2025.1, #102**: the cart handler of the releases up to 2026.4 adds `addDeliveryAddresses`,
    `updateDeliveryAddresses`, `removeDeliveryAddresses`, `replaceDeliveryAddresses`, `addGiftCardCodes` and
    `removeGiftCardCodes` (`cartDeliveryAddressesAdd`...), with the same operation names otherwise. Hydrogen 2026.10
    is a library rather than a framework: `createStorefrontClient({ type, config })` returns a client whose
    `graphql(document, { variables })` sends to the same Storefront API (key `graphql`, and `storefrontClient.graphql`
    / `storefront.graphql` as context clients); a client read from React Router's typed context
    (`context.get(storefrontClientContext)`, a key made by `createContext()`) is the framework's. The cart's query is
    `Cart` (`HydrogenCartFragment`): `getCart(cartId, client, query?)` (the call's own document when it gives one)
    and `cartHandlers.get(...)` of `createCartServerHandlers()` (key `createCartServerHandlers#get`: a method of what a
    factory returns, `<factory>#<method>`). The handlers' `post` runs the mutation the request's body names, and
    handlers registered with `handleShopifyRoutes({ handlers })` are called by the library: neither is reported.
  - **REST** (#83): `shopify-api-node`'s resources (`shopify.product.list(params)`, `productImage.get(productId, id)`,
    `order.close(id)`: the methods its base and child mixins give each resource, and those built the same way, read
    from the library's sources by a one-off script; the body goes under the resource's key, `bodyWrap`:
    `{ product: params }`); `@shopify/shopify-api`'s REST client (`new shopify.clients.Rest({ session }).get({ path:
    "products", query })`, `post({ path, data })`, also `admin.rest` of the app packages) and REST resources
    (`shopify.rest.Product.all({ session })`, `find({ session, id })`, `count`, `delete`, the paths of the 2026-07
    resources, a method with several paths left out); `createAdminRestApiClient(...)` `.get(path)`, `.post(path, {
    data })`; Python `ShopifyAPI` (`shopify.Product.find()` lists, `find(id)` reads one: `argPath`; `count`,
    `create(attributes)`, `delete(id)`, `Shop.current()`, top-level resources only). Paths are
    `/admin/api/{version}/<resource>.json`; a path the code gives already carrying the slash or the `.json` is not
    doubled. Resource names are common words (`order.list`, `Order.find`): these registries are `callersOnly`, so an
    untyped parameter is theirs only when its callers pass one of their clients.
  - **REST, #92**: `admin.rest.resources.Product.all({ session })` of the app packages (`keyAliases`: a key prefix
    the code may write for the registry's); methods with several candidate paths (`Metafield.all({ session,
    product_id })`, `Event.all`): `paths` lists the others and the one most placeholders of which the call gives a
    value, all of those it maps given, is the request, as the library picks it (`src/resolve/sdk-template.ts`).
    Records: `const product = new shopify.rest.Product({ session })`, then `product.save()`, `product.delete()` or
    the resource's own methods (`order.close()`): keys `rest.<Class>#<method>` (a method of a value built with
    `new`), ids read from the properties the code sets on the record before the call (`record:<id>` params,
    `product.id = id`, through the edits of #38), `save()` sending those properties as the body (`record.body`) and
    becoming a `PUT` to the record's path once its `id` is set (`record.withId`). Since #102, a record read with
    `find` (`const product = await shopify.rest.Product.find({ session, id })`, the registry's `recordFrom`) is
    followed the same way: its ids are those `find` was given (`RawCall.record.found`), so `product.save()` PUTs the
    properties set on it to `/products/{id}.json`; a page of records (`all`) is not followed. `shopify-api-node`
    methods whose body the library builds itself:
    `customerAddress.create(customerId, params)` sends `{ address: params }`, `fulfillmentOrder.close(id, message)`
    `{ fulfillment_order: { message } }` (a dotted `bodyWrap`); `article.tags(blogId?, params)` (#102) reads a blog's
    tags or every article's, the library telling the id from the options by their kind (`optionalId`: an object given
    last in the id's place is the options, `null` no id), at `/admin/...` without the API version, as it sends them.
    Python `ShopifyAPI`: resources nested under an owner
    (`Variant.find(product_id=p)`, `Transaction.find(order_id=o)`) or naming it (`Metafield.find(resource="products",
    resource_id=p)`), through `paths` as above; records (`shopify.Product(attributes).save()` POSTs the attributes,
    a `PUT` when they hold the `id`; `shopify.Product.find(id).save()` PUTs, `.destroy()` DELETEs,
    `Order.find(id).close()` POSTs `/orders/{id}/close.json`). Since #102, attributes a record is given one by one
    (`product.title = t`, lowered as `FunctionDef.attrSets`, read by `src/lang/ir/record.ts`) join its body, after
    those it is built with, in the function that saves it (a key set in a branch is optional); `product.id = pid`
    makes the `PUT`; a record read with `find` sends those attributes only; the owner ids of a nested resource given
    to the constructor (`Variant({"product_id": p})`) stay out of the body, as pyactiveresource takes them out.
    `Province` and `GiftCardAdjustment`, whose prefix starts with `/admin/` after a site that already ends with
    `/admin/api/{version}`, are at the doubled path the library requests
    (`/admin/api/{version}/admin/countries/{country_id}/provinces.json`).
  - **Auth and proxy, #92**: `shopify.auth.tokenExchange(...)`, `refreshToken`, `callback`, `clientCredentials` and
    `migrateToExpiringToken` request `POST /admin/oauth/access_token` (the body, the app's credentials, is the
    library's); `shopify.clients.graphqlProxy({ session, rawBody })` forwards the document the browser sent: a GraphQL
    operation the scan cannot name.
- **sgqlc** (#67, `src/lang/python/registry/sgqlc.json`): the endpoint is called directly
  (`HTTPEndpoint(url, base_headers)(document, variables)`, also `RequestsEndpoint`): the registry's key is `()`, the
  call of the instance, and the endpoint is the one the instance is built with. The document is text, or an
  `Operation(schema.Query, name=...)` (`src/lang/python/sgqlc.ts`, the Python front end's `documentOf`): its type is
  the one the class named (`Query`, `Mutation`, `Subscription`), and its fields the selections the function that
  builds it makes on it, through variables (`issues = op.repository(owner=o).issues(first=10)`, `issues.nodes.title()`,
  `.__fields__("a", "b")`; `__as__(Type)` is an inline fragment), written in GraphQL as sgqlc writes them (`created_at`
  is `createdAt`), at most 2,000 paths 32 deep. A project function given the operation or one of its selections
  (`fetch_issues(op, issues)`, #83) makes its selections under what it is given, three helpers at most. An endpoint
  the code receives as a parameter (`def download(endpoint): endpoint(op)`, #83) is the one its callers pass, else, in a
  project whose manifests declare `sgqlc`, an endpoint whose URL is unknown; a parameter called with anything but an
  `Operation` is a callback, not an endpoint.
- **Bounds.** The document comes from a hostile repository: 100,000 characters, 50,000 parser tokens, 32 levels of
  selection sets, 20,000 selection sets visited while inlining fragments, 2,000 field paths. A document read in the
  code is kept to its first 1,000 characters past the size bound, and fragments interpolated into fragments are read
  once each. Past a bound `fields` is left out (not cut short) and `name` / `type` come from the document's header
  when it has one. An AST document is read only while every
  definition is a JSON-like literal (strings, numbers, booleans, `null`, arrays, objects; `__proto__` keys dropped),
  within 4,000,000 characters, 200,000 values and 128 levels of nesting; otherwise its first operation's type and
  name are kept, and its fields left out. The text it prints to has the bounds above. sgqlc operations keep their
  first 2,000 selections.
- **Bounds reached are diagnostics** (#55, schema 1.19): each call whose document was read past a bound gets a
  `diagnostics.unfollowed` entry with reason `graphql-limit` and `detail` naming the bound (`document-size`,
  `document-parts`, `tokens`, `depth`, `fragment-expansion`, `fields`, `operations`, `ast-size`, `ast-nodes`,
  `ast-nesting`), once per location and bound, so `complete` is false as for any call not followed: a missing
  `fields` then tells a document the scan could not fully read from one that is not in the code. `unfollowed` rather
  than a list of its own: the smallest additive change, and the entries carry what the others do (file, line, why).
  The bound travels with the document: a front end that cuts a document short (`truncated()` in
  `src/resolve/graphql-source.ts`, an AST document, a Relay artifact, sgqlc) marks the part it leaves out with the
  bound, the parser names the bounds it reaches (`readDocument()`), and `src/operation/limits.ts` records the bound
  on each `Operation` built from such a document; both front ends turn it into the diagnostic when they build calls.
  A part left out because the scan cannot compute it (a value, a fragment from a package), a document that is not in
  the code (a persisted query's hash, a Relay artifact without `text`) and an AST document holding a reference are
  not bounds. Not reported: `#import` lines past four files, AST documents spread in past four documents, and sgqlc
  selections more than 32 deep, which leave a fragment's or a selection's fields out rather than the document's, and arguments left out past
  their own bounds (#56).
- **Not covered**: the keyword arguments of `sgqlc` selections (`op.repository(owner=o)`: its document is built
  without them, so it has no `arguments`); AST documents built by code
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

**SOAP client libraries** (#58) build the envelope from a WSDL: the call is the operation the code calls on the
client, with its own `client` value (`php-soap`, `zeep`, `node-soap`), `POST`, `operation: { protocol: "soap", name,
from: "body" }` and the arguments as an `xml` body (their shape, not an envelope).

| library | client | operation |
|---|---|---|
| PHP ext-soap (`php-soap`) | `new \SoapClient($wsdl, $options)`, a subclass (`parent::__construct($wsdl)` for `$this->Op()`), a typed `SoapClient` parameter | `$client->Track($args)`; `__soapCall('Track', [$args], $options)` / `__call`, whose name may be computed; `__getFunctions()` and the other `__` methods are the client's own |
| zeep (`zeep`) | `Client`, `AsyncClient`, `CachingClient` of `zeep` / `zeep.client` | `client.service.Track(Id=x)`, `client.bind(service, port).Track(...)`, `client.create_service(binding, address).Track(...)`; keyword arguments are the message (`_soapheaders` and other `_` ones left out), else the first argument |
| node-soap (`node-soap`) | `createClientAsync(wsdl, options, endpoint)`, `createClient(wsdl, options, callback, endpoint)` (its callback's `client` parameter), a value typed `soap.Client` | `client.TrackAsync(args)`, `client.Track(args, cb)`, `client.Service.Port.Track(...)`; the client's own methods (`addSoapHeader`, `describe`, `setSecurity`, ...) are not operations |

The URL (`src/resolve/soap-endpoint.ts`), the first that applies:

1. the address the code gives the client: PHP's `location` option (of the constructor, or of `__soapCall`), node-soap's
   `endpoint` argument or option, zeep's `create_service` address;
2. the address a WSDL file of the repository declares: the WSDL argument is a path (relative to the source file, then
   to the scanned directory, `file://`, or a computed directory and a file name: `__DIR__ . '/x.wsdl'`,
   `os.path.join(os.path.dirname(__file__), "x.wsdl")`, `path.join(__dirname, "x.wsdl")`), read through
   `readConfigFile` (inside the scanned directory, a regular file, 2 MiB and 20,000 tags at most) with the tokenizer of
   `xml-shape.ts` (no DTD, no entity expansion). Its one http(s) `soap:address` / `soap12:address` / WSDL 2.0
   `endpoint` address is the URL; ports that disagree give none;
3. the WSDL URL without the query asking for it (`?wsdl`, `?WSDL`, `?singleWsdl`): a service answers both on one URL.
   A WSDL in an environment variable is that variable's host (`hostKind: "env"`);
4. else an unknown host (`hostKind: "unknown"`): a WSDL file the scan cannot read, a client built where it cannot see,
   no WSDL and no `location`. A WSDL given by URL is never fetched.

A WSDL file the scan reads also names the operations: a method it does not declare is not one (a typo, a method of
the code's own), and a declared one is reported as the WSDL spells it (PHP finds `$client->track()` as `Track`).

**Not covered:** JAX-WS and Spring-WS (`WebServiceTemplate.marshalSendAndReceive`), with Java (#43); a subclass of
`SoapClient` built outside its own methods (`(new CarrierClient())->Op()`) has an unknown host; WSDL imports
(`<wsdl:import>`) are not followed; the `SOAPAction` a WSDL declares is not reported.

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
- A client a TypeScript / JavaScript constructor keeps in a field from an untyped parameter (`constructor(client) {
  this.client = client }`, or a parameter property, the field set nowhere else) is that parameter: `this.client.graphql(q)`
  follows the `new` expressions of the class (#83). A one-member method there (`graphql`) is followed through the callers
  only: neither the manifests nor a `receiver-unknown` diagnostic speak for so common a name.
- A registry whose method names are common words (`callersOnly`: `shopify-api-node`'s `order.list`, ShopifyAPI's
  `Order.find`, Hydrogen) is followed through the callers only: a Prisma client given as `db` does not become Shopify
  because the manifests declare `shopify-api-node`, and its `db.product.create` is no `receiver-unknown`.
- A Python parameter called directly (`endpoint(op)`, #83) is a receiver only when its argument is a document the
  library builds as an object (an sgqlc `Operation`): the registry key `()`, the callers' endpoint, else the one the
  manifests declare (`unknown` host). Any other parameter called is a callback.
- An untyped parameter holding the client (`ctx.provider.getBalance(a)`, #98) is followed through the callers only:
  their object's property (`settle({ provider })`) is the client; neither the manifests nor a diagnostic speak for it.
- A client destructured from an untyped object parameter (`async function move({ source, userId }) {
  source.auth.admin.getUserById(userId) }`, TypeScript / JavaScript) is that property of what the callers pass
  (`move({ source: createClient(u, k), userId })`), then the manifests as for a plain parameter. A builder chain on it
  (`source.storage.from(b).download(p)`) is not followed yet.
- Bounds: 50 callers per function, 4 distinct clients per call. Callers are only followed one level; a client passed
  through two helpers is found at the outer call site by wrapper expansion and inside the inner helper through the
  manifests.

| language | status |
|---|---|
| Python | callers (functions, methods, constructors), manifests, `receiver-unknown` |
| PHP | same engine, same behaviour (`tests/fixtures/php/receiver/`) |
| TypeScript / JavaScript | callers (functions, arrow functions, methods, and the `new` of a class keeping the client in a field, #83) in the scanned files, `package.json` manifests, `receiver-unknown` |
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
call site keeps its own single value. A helper's value read through a call that leaves a parameter out
(`context.get("model")` for `def get(self, key, default=None)`) reads that parameter's default, not what other callers
pass.

- **Headers.** `headerValues` keeps one value per header: the first, or null when one value cannot be read. A header
  that can take several values also lists every literal one in `headerAlternatives` (schema 1.8.0). Credential headers
  never list values.
- **What counts.** Literal scalars, constants, env var defaults and class attributes (`model or self.default_model`
  merges both; the default is listed in `model.sources`, [#125](report.md#model-names)); an object or a list a caller builds is read at that caller, not merged into the wrapper's call. `None`
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
| #3 Supabase, Firebase, Sentry registries; no-crash scans | done | supabase-py (tables, rpc, auth, storage, functions), firebase-admin (Firestore references, Auth, FCM), sentry-sdk (`capture_*`, not `init`); per-file parse / internal errors | kreait/firebase-php (typed services too), google/cloud-firestore, sentry/sentry (+ Laravel, Symfony); no official Supabase SDK | Firestore (google-cloud-firestore, firebase-admin, Android), firebase-admin Auth, FCM and Realtime Database, sentry-java / sentry-android capture calls (#33); supabase-kt Postgrest, Auth, Storage and Functions, Firebase for Android Auth, Realtime Database, Storage and Functions (#50); per-file parse / internal errors |
| #4 diagnostics | done | parse errors, internal errors, dropped calls, `injected-client`, `injected-fetch`, `wrapper-depth`, per-language file counts | same | same; a typed parameter that names no client is not an `injected-client` |
| #5 regression fixtures and recall | done; `tests/fixtures/{javascript,html}/**/expected.json` too | `tests/fixtures/python/**/expected.json` are part of the recall check | `tests/fixtures/php/**/expected.json`, same check | `tests/fixtures/kotlin/**/expected.json` and `tests/fixtures/java/**/expected.json` (the same clients in Java, a mixed Kotlin / Java project, #43): OkHttp (interceptors too), `java.net.http`, Ktor, Spring, Feign, Retrofit, clients a DI container provides (`di-*`, #46), the SDK fixtures of #33, #49 and #50 (`tests/fixtures/kotlin/sdk/`, `tests/fixtures/java/aws/`), negatives (server endpoints, JAX-RS resources, gRPC, builders of other libraries) |
| #6 provider roadmap | done | registries for every P1 / P2 provider with a Python SDK; `providers.json` lists PyPI packages per provider | the same for Packagist | Maven artifacts per provider in `providers.json`; registries for OpenAI, Anthropic, Stripe, AWS S3 and Bedrock Runtime, Gen AI, Firebase, Twilio, Slack, Sentry, PostHog (#33), openai-kotlin, Azure OpenAI, LangChain4j, Firebase Android, supabase-kt, SendGrid, Resend, Mailgun (#50), more AWS services and the AWS SDK for Kotlin (#49), Spring AI in #89 and #96 |
| #7 SDK coverage | done | PyPI manifests, import names (`modules.json`), `ecosystem: "pypi"` | `composer.json`, namespaces per package (`namespaces.json`), `ecosystem: "composer"` | Gradle (Kotlin and Groovy DSL, version catalog) and `pom.xml`, package roots (`src/lang/jvm/packages.json`), `ecosystem: "maven"`; a declared artifact's roots win over an undeclared one's |
| #8 provider resolution | done | env defaults, env var names, URL helpers, class base URLs; no template in `provider` | `env('X', 'default')`, `getenv() ?: '...'`, Laravel `config()` files, class constants, helpers, `$this->baseUrl` | `System.getenv("X") ?: "..."`, `System.getProperty`, `BuildConfig.X` with its Gradle literal, Spring `@Value("${x:default}")`, constants, `object` and companion members |
| #30 operation outside the URL | `operation` field and its name in `id`; JSON-RPC (#34) and GraphQL (#35) from the body shape, query and SDK document argument; `gql` tags, `.graphql` imports, codegen AST documents (#56), Octokit `graphql()`, Apollo, urql and graphql-request (#54), Relay (with its compiled artifacts) and Shopify's clients (#67), Hydrogen, Relay containers and `loadQuery` (#83); the Hydrogen cart and Relay fragment refetches (#92); Hydrogen 2026.10 and `useQueryLoader` variables (#102); JSON-RPC client libraries (#52); SOAP and action-style APIs (#36) from headers, the XML body and the query; node-soap clients (#58) | JSON-RPC, GraphQL, SOAP and action-style APIs from the body shape, headers and query; the `gql` client (#54), `sgqlc` (its `Operation` documents too) and ShopifyAPI (#67); web3.py and solana-py (#52); zeep (#58) | JSON-RPC, GraphQL, SOAP and action-style APIs from the body shape, headers and query; `SoapClient` (#58) | same engine; no JSON-RPC, GraphQL or SOAP fixture yet |
| #37 SDK client as an untyped parameter | callers (constructor parameters stored on `this` too, #83), manifests, `receiver-unknown`, `clientFrom` | callers (constructors too), manifests, `receiver-unknown`, `clientFrom` | same as Python | does not apply (parameters are typed) |
| #39 a parameter's values | initializers and callers through checker references | defaults and callers through the IR | same | same engine (Kotlin parameter defaults are lowered); Retrofit interface methods get their callers' arguments and defaults (`tests/fixtures/kotlin/retrofit/`, the Android fixture); SDK wrappers read their callers' values like Python |

## Adding a language

1. Add the tree-sitter grammar as a dev dependency and to `GRAMMARS` in `src/lang/grammars.ts` (only its `.wasm` ships;
   the build copies it next to the bundle). A grammar with no npm release that loads in web-tree-sitter 0.27 is built
   from its source and committed, listed in `BUILT_GRAMMARS` (Dart: `pnpm gen:dart-grammar`).
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
Kotlin) is an `IrSource` in that language's `alsoReads`, so both are lowered into one index. A language whose calls are
command lines rather than expressions (shell) reads its syntax tree directly into the `ResolvedCall` of
`src/assemble.ts`, without the IR (`src/lang/shell/`).

Measured on 2026-10-16 over a set of active production repositories (primary GitHub language of each, latest scan): Dart
29 repositories (26 with no call found; Dart is read since then, 20 of them with calls), Jupyter Notebook 9 (7 with
none; notebooks are read since then), C# 5, Ruby 3, PowerShell 3, Swift 2. Vue, Svelte and Astro components are read
since then too.

| next candidates | ecosystem | notes |
|---|---|---|
| Ruby | RubyGems (`Gemfile`) | `Net::HTTP`, `Faraday`, `HTTParty`; SDKs are mostly module-level (`Stripe::Customer.create`) |
| C# | NuGet | `HttpClient`, RestSharp, typed SDK clients |
