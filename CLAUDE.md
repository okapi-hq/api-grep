# CLAUDE.md

Guidance for AI agents working in this repository. Human-facing docs: [README.md](README.md) (short pitch, quick
start, links: keep it short and put reference material in `docs/`), [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/detection.md](docs/detection.md) (clients and patterns per language, resolution rules, limitations),
[docs/report.md](docs/report.md) (the report field by field), [docs/server.md](docs/server.md) (server, Docker),
[docs/security-model.md](docs/security-model.md) (redaction, untrusted input), [docs/languages.md](docs/languages.md)
(architecture, per-language status, plan), [docs/sdk-support.md](docs/sdk-support.md) (generated SDK matrix).

## What this is

`api-grep` statically lists the outbound HTTP and SDK calls of a repository: provider, method,
path template, body / query / header shapes, auth scheme, and where each part came from. The report states facts only
and leaves any judgement (a score, a verdict) to its consumer. Supported languages: TypeScript, JavaScript, HTML
(inline scripts and forms; Vue, Svelte and Astro components' scripts), Python (Jupyter notebooks too), PHP, Kotlin
and Java (one front end and one index for both: HTTP clients, Retrofit, Feign and the JVM SDK registries; `docs/languages.md`), Go, Rust and shell scripts (curl, wget, HTTPie). It must stay
static: no network, no code execution, no AI.

## Commands

```sh
pnpm install
pnpm dev scan <dir> [--json] [--language python,php]   # CLI from source
pnpm dev serve [--port 8080]                           # HTTP server from source (docs/server.md)
pnpm test                    # vitest: fixture snapshots, recall check, unit tests
pnpm test:e2e                # builds dist/ and runs the CLI as a subprocess (incl. hostile-repository cases)
pnpm vitest run -u           # update snapshots after an intended change, then review the diff
pnpm lint                    # zero warnings; max 300 lines per file, 50 per function
pnpm typecheck
pnpm eval:inventory --repos <dir> --inventory <csv|json>   # #114: totals of a reference-inventory evaluation (eval/README.md)
pnpm build                   # tsup -> dist/, copies tree-sitter grammars to dist/grammars
pnpm gen:schema              # regenerate schema/report.v1.json after a report schema change (bump SCHEMA_VERSION)
pnpm gen:support             # regenerate docs/sdk-support.md after a registry / providers.json change
pnpm gen:stripe-ports        # regenerate ported Stripe registries from src/detect/registry/stripe.json
pnpm gen:telegram            # regenerate the Telegram registries (every language) from scripts/telegram/
docker build --build-arg API_GREP_COMMIT=$(git rev-parse --short=12 HEAD) -t api-grep .   # the image (serve by default)
```

Run lint, typecheck, test and test:e2e before declaring work done; CI runs the same.

Releases are automatic: every push to main runs semantic-release (`.releaserc.json`, `.github/workflows/docker.yml`),
which tags `vX.Y.Z`, writes the GitHub release and publishes the image with that version. Title commits and pull
requests as Conventional Commits (`fix:` patch, `feat:` minor, `feat!:` major); never bump `package.json`'s version.

## Architecture in one screen

- `src/scan.ts` runs each language in `src/lang/index.ts` and merges calls, diagnostics and coverage.
- A language (`src/lang/types.ts`) returns report `Call`s. Everything after that is shared: examples, schema check,
  redaction, stats, diagnostics, coverage. `src/assemble.ts` builds the `Call` (provider, id, `optionsOpaque`,
  `bodySource`) for every language.
- TypeScript, JavaScript and HTML: `src/lang/typescript/` wraps the ts-morph pipeline in `src/detect`, `src/resolve`,
  `src/wrappers` (JavaScript through `allowJs`; an HTML page becomes a same-size JavaScript file of its inline scripts,
  see `src/lang/html/`; a Vue, Svelte or Astro component, a same-size TypeScript file of its `<script>` blocks and
  Astro frontmatter, `src/lang/html/components.ts`, with `location.language` `typescript`). Memory (#68): `graph.ts`
  groups the files that can see each other (imports either way,
  `/// <reference>`, `declare module`, globals); `batches.ts` packs groups into projects of about 16 MB of source (a
  smaller repository is one project, without the pre-pass), scanned one after the other (`batched.ts`), results
  merged in single-project order; `checker-budget.ts` drops a project's checker after a fixed count of types or
  instantiations (never on the heap: a report depends on the input only); `src/module-resolution.ts` resolves imports
  without keeping every path tried. A scan of the public eval fits in a 2 GB heap (`pnpm eval` runs with it).
- Tree-sitter languages (Python, PHP, Kotlin, Java, Go, Rust): `src/lang/<lang>/lower*.ts` turns the syntax tree into the IR of `src/lang/ir/model.ts`; the
  engine in `src/lang/ir/` (lookup, chains, evaluation, shapes, SDK and HTTP-table detection, wrappers, build) does the
  rest. A file of another format a grammar reads goes through the source's `readText` hook (`IrSource`): Python reads a
  Jupyter notebook as its code cells on their notebook lines (`src/lang/python/notebook.ts`), and a cell holding a
  syntax error is left out (`ReadText.without`) rather than the notebook. A language is mostly data: `clients.json`, `registry/*.json`, manifests, `index.ts`. Grammars are listed in
  `src/lang/grammars.ts`. JVM manifests (Gradle, version catalogs, `pom.xml`), Maven package roots and `BuildConfig`
  values are in `src/lang/jvm/`, shared by Kotlin and Java; so are the JVM HTTP clients (`src/lang/jvm/http/`: OkHttp and
  its interceptors, `java.net.http`, Ktor, Spring, Feign, Retrofit; request objects sent by a call, `requests.ts` over
  `requests.json`: Apache HttpClient, JAX-RS client, AsyncHttpClient, Unirest, Vert.x `WebClient`), detectors over the IR
  driven by `clients.json`, with the
  engine's builder steps (`ir/steps.ts`), entry-by-entry values (`ir/fluent.ts`) and header / query pairs
  (`ir/pairs.ts`, `Call.clientParts` for those an interceptor or a client default adds, `optional` when an interceptor
  adds them on some requests only, `ir/conditional.ts`), and the JVM SDK registries
  (`src/lang/jvm/registry/`): SDK parameters given as builders (`X.builder().a(1).build()`) read as dicts through the
  language's `resolveCall` (`src/lang/ir/builders.ts`, rules in each registry's `setters`; Lombok `@Builder` classes and
  getters of the project in `src/lang/jvm/lombok.ts`). Clients a DI container provides (#46: Dagger / Hilt, Spring,
  Koin) are bindings and injection points in `src/lang/jvm/di/`, which the engine asks through the language's
  `injection` hook (`ir/injected.ts`) wherever a parameter or field has no other value; when several bindings fit,
  none is attached.
- Kotlin and Java (#43): one front end. `kotlinLanguage` lists Java's `IrSource` (`src/lang/java/index.ts`) in
  `alsoReads`; `scanIr` (`src/lang/ir/scan.ts`) lowers every source language the scan asks for into one module set and
  one `ProjectIndex`, each module keeping its `language` (the call's `location.language`), and computes the `maven`
  coverage once. Java lowering is `src/lang/java/` (classes, `<init>` / `<clinit>`, annotations, lambdas, anonymous
  classes, string building, configuration reads); helpers both languages lower the same way are in `src/lang/jvm/`
  (`calls.ts`, `annotations.ts`, `paths.ts`).
- Pure helpers shared by all languages: `src/resolve/{parts,url-shape,url-reference,header-names,shape-utils,sdk-template,string-template}.ts`;
  SOAP client libraries (#58: `SoapClient`, zeep, node-soap) share `soap-endpoint.ts` and `wsdl.ts` (a WSDL file of the
  repository, read through `readConfigFile` with the capped XML tokenizer, never one by URL).
- Keys added to a dict or object after it is built (#38): tree-sitter languages lower `kwargs["k"] = v`, `.update`,
  `del`, `$params['k'] = $v` as `Assign.edit`, and `lookup` folds them in (`src/lang/ir/edits.ts`); TypeScript applies
  them to the shape (`src/resolve/object-edits.ts`, `edited-shape.ts`). Rules in `docs/languages.md`.
- A parameter's values (#39): a body value, model or header that is an unsubstituted parameter reads the literals its
  callers pass (one level) and its default; callers come from `src/lang/ir/param-values.ts` (IR) and
  `src/resolve/param-values.ts` (TypeScript references), merged by `src/resolve/param-shape.ts`; several header values
  go to `Call.headerAlternatives`.
- `src/model/`: the `model` fact of a call (`fact.ts`: argument, body or path) and the routing of libraries that pick
  the provider from the model name (`route.ts`, registries with `routeByModel`, provider `llm-router` until routed).
  Runtime model names (#125): a value's source rides on scalar shapes under the `VALUE_SOURCES` symbol (never in a
  report shape; `value-sources.ts`: `default` for fallbacks, parameter and settings defaults, `config_file`), and
  `fact.ts` lists it as `model.sources`; `alternativesOf` (`resolve/shape-utils.ts`) keeps literal and env values
  beside a value-less string where `unionOf` would merge them away. Example env files (commented-out lines too) add
  `env_example` names after assembly (`env-examples.ts`). Config files loaded by a literal path are read by
  `config-files.ts` (JSON, `yaml-data.ts`, TOML): IR as a dict expression whose strings carry their source
  (`ir/config-load.ts`, Python loaders in `python/config-load.ts` through `resolveCall`), TypeScript in
  `resolve/config-values.ts` (JSON imports, `JSON.parse(readFileSync(...))`, zod / t3 env schemas). IR record fields
  (`ir/object-fields.ts`) read pydantic-settings env names through the language hook `fieldEnv`
  (`python/settings.ts`), argparse defaults through `attrDefault` (`python/argparse.ts`); dict key reads
  (`d["k"]`, `.get(k, d)`, `.pop`) are `dictRead` in `ir/values.ts`.
- `Call.operation` (#30): the operation of protocols that name it outside the URL (JSON-RPC, GraphQL, SOAP, action
  APIs). `assembleCalls` (`src/assemble.ts`) reads it from the resolved request through `src/operation/`, one module
  per protocol (`json-rpc.ts` reads the body shape, `graphql.ts` parses documents with the `graphql` package; an SDK
  method's document argument is `ResolvedCall.document`; a codegen AST document reads as the text it prints to,
  `src/resolve/graphql-ast.ts`, #56; the literal arguments of selected fields are `operation.arguments`,
  `graphql-arguments.ts`, #56; `soap.ts` reads the `SOAPAction` header and the XML
  envelope, `action.ts` the query or form parameter a provider's `operationParam` in `providers.json` names), unless
  the front end set `ResolvedCall.operation`; `callId` hashes its name; a batch is one `Call` per operation. A GraphQL document read past a bound (#55) marks its
  `Operation` (`src/operation/limits.ts`); both front ends' `buildAll` turn it into a `diagnostics.unfollowed`
  `graphql-limit` entry. Schema,
  batch decision and per-protocol status (#34 to #36) in `docs/languages.md`. XML bodies are `bodyEncoding: "xml"`
  with their element structure as the shape (`src/resolve/xml-shape.ts`: a capped tokenizer that never reads a DTD or
  expands an entity). GraphQL client libraries (#54: Apollo, urql, graphql-request, Python `gql`) are registries with
  an `endpoint` (the URL and headers of the client or its one transport, else the project's one client:
  `src/detect/endpoint.ts`, `src/lang/ir/endpoint.ts`) under the `anyHost` provider `graphql`, so a call's provider
  is the one its URL names. #67 adds Relay (a transport's `fetchIn`: the one `fetch` of `Network.create(fetchFn)`,
  `src/detect/fetch-endpoint.ts`; compiled artifacts in `src/resolve/relay-artifact.ts`), Python `sgqlc` (the endpoint
  object called directly, key `()`; `Operation` documents read by the Python front end's `documentOf`,
  `src/lang/python/sgqlc.ts`) and Shopify's clients, registries of the `shopify` provider with `documentArg`, as
  Octokit's `graphql`. #83: `.myshopify.com` names the `shopify` provider; clients a factory returns in an object
  (`factoryReturn` in `src/detect/callee.ts`) or a constructor keeps in a field (`fieldReceiver`, `src/detect/receiver.ts`);
  Hydrogen's context clients (`contextClients` in `hydrogen.json`, `ReceiverResolver.contextCall`); Shopify REST
  resources (`bodyWrap`, `argPath`; `callersOnly` keeps common resource names from the manifest fallback); Relay
  `loadQuery`, containers and `<QueryRenderer>` (a registry's JSX `components`, `src/detect/component.ts`); sgqlc
  endpoints given as parameters (key `()` when called with an `Operation`) and selections made by helpers. #92:
  Shopify REST records (keys `rest.<Class>#<method>` for a method of a value built with `new`, `record` in
  `MethodSpec`: `record:<id>` params and the body read from the properties set on it, `withId` for `save()` as a
  `PUT`), candidate `paths` picked by the ids given (`src/resolve/sdk-template.ts`), `keyAliases`
  (`admin.rest.resources.`), dotted `bodyWrap`; Hydrogen's cart (`document`: a document the library writes); Relay
  `useQueryLoader` and fragment hooks (`sendsThrough`, `refetchQuery`, `src/resolve/relay-refetch.ts`). #102: records
  read with `find` (`recordFrom`, `RawCall.record.found`), Python record attributes (`FunctionDef.attrSets`,
  `src/lang/ir/record.ts`), `loadQuery` variables (`sendsThrough.bodyArg`, `src/detect/sender.ts`,
  `RawCall.bodyAlternatives`), `optionalId` (`article.tags`), `<factory>#<method>` keys for what a factory returns,
  Hydrogen 2026.10 (React Router context reads in `builtHere`). JSON-RPC client libraries (#52: `@solana/web3.js` and `@solana/kit`, viem, ethers,
  web3.js, web3.py, solana-py) work the same way under the `anyHost` provider `json-rpc`, each method naming the RPC
  method it sends (`rpc`, or `rpcArg` for `send(method, params)`; `rpcClientOperation` in `json-rpc.ts`); their
  `endpoint.nonHttp` lists wallet and socket constructions, and a call is reported only when its client reads as HTTP
  (`src/detect/rpc-endpoint.ts`; `irEndpoint` returns null otherwise). #78: contract objects are registry keys with
  `*` for the ABI's function (`Contract.*`, `methods.*.call`, `eth.contract.functions.*.call`; `notFunctions` lists
  the object's own members); ethers' runner and ABI decide what a direct call sends (`src/detect/rpc-contract.ts`,
  `contract-abi.ts`, `endpoint.signers`); vendor providers build their host from the network (`endpoint.clients.*.vendor`,
  `src/detect/rpc-vendor.ts`); web3.py properties are `property` entries, lowered as `FunctionDef.reads`. #85: clients
  from a cache a helper fills (`src/detect/client-cache.ts`, `rpc-cache.ts`, `Callee.cached`: one endpoint only when
  every cached client agrees), a context object or provider (`useConnection()`, `endpoint.clients.*.component`), wagmi
  configs (`wagmi.json`, `src/detect/rpc-config.ts`: `config`, `deep` transports), TypeChain factories
  (`typechain.ts`), `connect` / `attach` and typed contracts (`contract-forms.ts`), JSON ABIs (`json-abi.ts`). #98, for
  every SDK: the app's React contexts (`react-context.ts`) and `useMemo` (`src/ast/react.ts`) read by `held.ts` in
  `callee.ts`, context objects given as untyped parameters (`Receiver.held`), factories a constructor is handed
  (`injected-fn.ts`), ConnectKit configs (`innerConfig` in `rpc-config.ts`); Python dict caches (`src/lang/ir/cache.ts`,
  `Seg.cache`).
- SDK clients passed as untyped parameters (#37): `src/lang/ir/receiver.ts` and `src/detect/receiver.ts` follow the
  callers one level up (one call per distinct client), else the one SDK the nearby manifests declare with that method,
  else `diagnostics.unfollowed` `receiver-unknown`; `Call.clientFrom` says which (`docs/languages.md`).
- Go (`src/lang/go/`): a module name is the file's import path (`go.mod`'s `module` and the directory, dotted:
  `github_com.acme.bot.internal.llm`; registries and `clients.json` give Go import paths, converted by `importRoot`);
  the files of a directory are one package (`packageScope`), and the language's `link` hook (`link.ts`, run once every
  file is lowered) merges a type's methods declared in other files and gives struct fields the values of the project's
  struct literals. A struct literal lowers as a call of its type with named arguments (`composite.ts`); `resolveCall`
  (`structs.ts`) reads it as the dict it serializes to (`json` tags; an SDK's naming, `MaxTokens` -> `max_tokens`) and
  SDK helpers as what they build. `http.NewRequest` requests are reported where they are built (`nethttp.ts`), with the
  headers and query the function then sets; `net/http` functions and Resty are tables (`clients.json`; Resty's
  `SetBody` / `SetQueryParam` are the `ClientModifier` fields `bodyArg` / `queryArgs`). Model and method constants are
  `constants.json` (`openai.GPT4o`), extracted from the SDKs' sources.
- Host tables (`src/resolve/choice.ts`): a base URL picked at run time from a table the code writes (`PROVIDERS[name]`,
  `LIST.find(...)`, Python `next(d for d in L if ...)` lowered as `L[?]`, a helper's several returns, a Rust `match`
  lowered as `cond`s marked `match`, Rust / Kotlin list searches) is a choice point of both evaluators (`ctx.choice`: `ast/object.ts` and
  `resolve/evaluate.ts`, `ir/values.ts` and `ir/evaluate.ts`). `withCandidates` builds a call once recording the
  points its URL meets, then once per entry of the first that tells hosts apart (the whole call, so a model the same
  entry names follows), one call per candidate host with `hostAlternatives`; over 20 entries, a `host-table-limit`
  diagnostic. Without a pick, every point reads as before. A key or helper argument the code fixes is no table
  (`resolve/table-read.ts` `knownValue` / `fixedValue`, IR `fixed`): facts only, never a best guess.
- `coverage.hosts` (`src/hosts/`): the API-looking hosts in the string literals of the scanned files (each front end
  hands its literals over: `src/lang/typescript/host-literals.ts` walks the TypeScript AST, `src/lang/ir/host-literals.ts`
  the tree-sitter string nodes while lowering), compared with the calls' hosts; the filter is `api-host.ts` (paths
  that are no call, `url-noise.ts`: OAuth authorization pages and scopes, docs pages, cloud endpoints to fill in),
  and each front end gives a literal a role from where it sits (`typescript/host-context.ts`, `ir/host-context.ts`,
  read by name in `hosts/context.ts`: a log's or an error's text, a redirect, a link key, a `url` beside no request
  key), Rust's test items through `IrSource.testCode`; rules in `docs/report.md#host-coverage`. A recall proxy: keep
  it low-noise (a docs link counted reads as a missed call).
- Shell (`src/lang/shell/`): not the IR. tree-sitter-bash parses `.sh` / `.bash` / `.zsh` files and extension-less files
  with a shell `#!` line (`files.ts`); `scope.ts` collects the file's assignments (`export`, `readonly`, `local`, arrays,
  loop and `read` targets, the most informative one wins: a value over `X="$2"` option parsing over `X=""`), `words.ts`
  turns words into `Part`s (an unassigned `$X` is an env read, `${X:-default}` one with a fallback), `argv.ts` expands a
  command's arguments (`"$@"`, `"${ARR[@]}"`, `$CURL` set to `"curl -s"`, runners such as `sudo` / `timeout`), and
  `curl.ts` / `wget.ts` / `httpie.ts` read the options into a `ShellRequest` that `build.ts` turns into a `ResolvedCall`.
  A function sending a request built from its arguments is expanded at its call sites in the file, one level, with the
  `case` / `if` branches the arguments select (`extract.ts`, `branches.ts`); `source ./x.sh` gives the sourced file's
  top-level values to env reads (`sourced.ts`). A file mostly unread by the bash grammar (zsh syntax) is a `parse-error`.
- Rust (`src/lang/rust/`): a module name is its path in its crate (the crate's name from the nearest `Cargo.toml`, `-`
  as `_`, then the path under `src/`: `relay_bot.llm.client`); `use`, `crate::`, `self::` and `super::` paths are made
  absolute while lowering (`paths.ts`), an inline `mod x { }` is a class of its file, and the `link` hook moves `impl`
  methods to their struct's class and gives struct fields the values of the project's struct literals (`link.ts`).
  Macro arguments are tokens to tree-sitter: `format!`, `concat!`, `env!`, `vec!`, `lazy_static!` are parsed again
  (`reparse.ts`, positions mapped back through `SHIFT`), `json!` is read from its tokens (`json-macro.ts`).
  Conversions and error handling (`.clone()`, `?`, `.unwrap()`, `Arc::new`) stand for their value at lowering
  (`calls.ts`). reqwest, ureq, awc and surf requests are built in steps after a verb call and reported at the call
  that sends them (`requests.ts` over `requests.json`, the engine's `fluentChains`); `resolveCall` (`structs.ts`) reads
  struct literals by their serde names and async-openai / openai-api-rs request builders. Registries give paths as the
  code writes them (`async_openai`); `Cargo.toml` (workspaces too) feeds coverage under `ecosystem: "cargo"`.
- `src/normalize/providers.json`: provider ids, hosts, and SDK packages per ecosystem (`npm`, `pypi`, `composer`, `maven`,
  `go` as module paths, `cargo` as crates.io names).
- `src/server/`: `api-grep serve`. `app.ts` routes and authenticates (`API_GREP_TOKEN`), one scan at a time. Each
  request runs two children through `child.ts` (own process group, deadline, minimal env, no git): the hidden
  `unpack` command (`unpack.ts` over `archive.ts`: files and directories only, limits, strict) and `scan --json`
  (`run-scan.ts`). `src/version.ts`: the version plus `+<API_GREP_BUILD>`.
- The report is a versioned contract (`src/report/schema.ts`, `schema/report.v1.json`): new fields or enum values bump
  the minor of `SCHEMA_VERSION`, breaking changes the major. Each call's language is `location.language`.

## Conventions

- Every detection or resolution change needs a fixture (`tests/fixtures/<group>/`, JavaScript and HTML under
  `tests/fixtures/javascript/` and `tests/fixtures/html/`, Python under `tests/fixtures/python/`, PHP under
  `tests/fixtures/php/`, Kotlin under `tests/fixtures/kotlin/`, Java and mixed Kotlin / Java under `tests/fixtures/java/`, Go under `tests/fixtures/go/`, shell under `tests/fixtures/shell/`). The recall check scans a fixture without its
  `tests/fixtures/php/`, Kotlin under `tests/fixtures/kotlin/`, Java and mixed Kotlin / Java under `tests/fixtures/java/`, Go under `tests/fixtures/go/`, Rust under `tests/fixtures/rust/`). The recall check scans a fixture without its
  subdirectories: a project with a nested layout (an Android app) is checked by its own test instead. Patterns from real repositories go in a directory with an `expected.json` so the recall
  check (`tests/recall.test.ts`) covers them; write fixtures from scratch with invented names.
- Snapshots are part of the review: never update them blindly.
- A per-file failure is a diagnostic (`diagnostics.skipped` / `droppedCalls`), never a crash.
- `provider` never contains a template (`{...}`).
- The scanned repository is hostile input: files are listed through `src/lang/files.ts` (symlinks must stay inside the
  scanned directory), config files and manifests are read through `readConfigFile()` (`src/files.ts`), the TypeScript
  checker, the file graph and the tsconfig read through `src/bounded-fs.ts` inside `readRoot()` (`src/tsconfig.ts`):
  the repository root (nearest `.git`, a directory or a worktree's file) when the scanned directory is in a git
  repository, else the scanned directory; never above it (no parent `node_modules` or `@types`), symlinks resolved and
  kept inside, so a report does not depend on the checkout location (#112). Keys from the code go through
  `isSafeKey()`, and anything printed goes through `printable()`.
- Registries: TypeScript in `src/detect/registry/`, Python in `src/lang/python/registry/`, PHP in
  `src/lang/php/registry/`, Kotlin and Java (JVM) in `src/lang/jvm/registry/`, Go in `src/lang/go/registry/`, Rust in `src/lang/rust/registry/` (format: `IrRegistryEntry` in
  `src/lang/ir/language.ts`; the JVM Stripe registry comes from `pnpm gen:stripe-ports`). A new registry package must be listed under its provider's `packages.<ecosystem>` in
  `providers.json` (a unit test checks it); then run `pnpm gen:support`.
- Python module names that differ from their PyPI name go in `src/lang/python/modules.json`; PHP namespaces per
  Composer package in `src/lang/php/namespaces.json`; Java / Kotlin package roots of a Maven `group:artifact` that are
  not its group id in `src/lang/jvm/packages.json` (`declaredOnly`: roots shared with non-SDK artifacts of the group,
  counted only where the manifests declare the package).
- The server's archives are hostile input too: never write anything but regular files and directories, never log a
  path, a query value or anything from an archive, and never pass the server's environment to a scan.
- Comments explain why, briefly; match the surrounding code.

## Where work is tracked

- Issues #3 to #8 (recall, diagnostics, fixtures, provider roadmap, coverage, provider resolution) apply to every
  language; `docs/languages.md` has a table of how each is covered in TypeScript, Python and PHP.
- Kotlin: #29 (parsing, lowering, manifests), #32 (OkHttp with interceptors, `java.net.http`, Ktor, Spring, Feign)
  and #31 (Retrofit interfaces, `retrofit.ts` / `retrofit-link.ts`, URLs resolved by RFC 3986 in
  `src/resolve/url-reference.ts`) are done; so are the JVM SDK registries #33 (OpenAI, Anthropic, Stripe, AWS S3 /
  Bedrock Runtime, Gen AI, Firebase, Twilio, Slack, Sentry, PostHog) and the AWS ones of #49 (DynamoDB and its
  enhanced client, SQS, SNS, SES, SES v2, the S3 Transfer Manager, the AWS SDK for Kotlin as `variants` of the Java
  2.x registries, its requests built by lambdas that assign properties: `FunctionDef.props`, S3 from the SDK for
  Java 1.x). #50 adds openai-kotlin, Azure OpenAI, LangChain4j, Firebase Android, supabase-kt, SendGrid, Resend and
  Mailgun, the registry fields `argFields`, `bodySelf`, `urlArg`, `setupUrl` (`src/lang/ir/setup.ts`),
  `setters.constructors` / `wrappers` (`src/lang/ir/constructed.ts`) and the language trait `indexOperator`. #89 adds
  Spring AI (`src/lang/jvm/registry/spring-ai.json` / `.ts`, registry field `configured`, the language hook `refineSdk`
  in `src/lang/jvm/spring-ai.ts`, Spring Boot `application.yml` / `.properties` read by `src/lang/jvm/spring-config.ts`),
  `methodFrom` (SendGrid), fluent maps with constructor `args` and `setterCase` (Azure options), `setters.putters`
  (supabase-kt lambdas), Kotlin property reads (`src/lang/kotlin/property-reads.ts`) and builders filled across
  functions. #96 adds the Azure OpenAI, Bedrock Converse, Google GenAI and DeepSeek starters, the provider of two
  starters by `@Qualifier`, `spring.ai.model.<kind>` or bean name (`src/lang/jvm/spring-ai-beans.ts`), Spring AI's model
  enums and starters' default models per release (`src/lang/jvm/spring-ai-models.ts` over
  `registry/spring-ai-models.json`, the release from the starter or `spring-ai-bom`: `Manifests.bom`), profiles and
  `classpath:` imports of the configuration (`spring-config.ts`, parsing in `spring-config-parse.ts`), the beans DSL's
  `ref<T>()` (the injection hook `lookupType`) and the registry param source `model`. DI-provided clients and the remaining builder forms (#46: Dagger / Hilt,
  Spring, Koin in `src/lang/jvm/di/`, the engine's `injection` hook; `apply { }` steps; Ktor and Spring forms) are
  done; so is #75 (`Lazy<T>` / `Provider<T>` holders, multibinding sets and Spring `List<T>` in
  `src/lang/jvm/di/collections.ts`, beans by their supertypes, Koin `bind` and Injekt in `locators.ts`, elements of
  injected collections in `src/lang/jvm/elements.ts`); #94 adds `@ConfigurationProperties`
  (`src/lang/jvm/di/config-props.ts`), Koin `getAll<T>()`, `ObjectProvider` streams, loops over collections
  (`FunctionDef.loops`), method references on builder variables and builder extensions adding interceptors; #100 adds
  interceptors wrapping others (`src/lang/jvm/http/interceptors.ts`), lists built with `buildList` / `add`, builders
  handed to a project function, nested and `@Bean`-bound configuration properties with their `application.yml` values.
  Calls in extension functions of a client type (#86: `FunctionDef.receiver`, `implicit` names, the extension a call
  runs in `src/lang/ir/extensions.ts`) are done.
- Java: #43 (Java lowering, one index with Kotlin, the JVM clients and registries on Java) and #65 (Apache HttpClient,
  JAX-RS client, AsyncHttpClient, Unirest, Vert.x `WebClient`, Lombok builders and getters, Kotlin `map["k"] = v`) are
  done; so is #73 (requests started in branches: one call per start, `fluentChains` in `src/lang/ir/fluent-chain.ts`,
  `request-alternatives.ts` and `IrRaw.alternatives`; overloads picked by their arguments in `src/lang/ir/overloads.ts`;
  client defaults and filters in `src/lang/jvm/http/request-defaults.ts`; Lombok `@Singular` / `toBuilder()`).
- Messaging and inference SDKs: Telegram (generated by `pnpm gen:telegram`; positional arguments named as body fields by
  `fieldArgs`, handler objects as their own entries or `contextClients`), discord.js (REST `Routes` through `routes` /
  `routeHelperArg`, `src/resolve/sdk-template.ts`), discord.py, huggingface_hub (`modelSeg`) and `@huggingface/inference`.
  Python reads `asyncio.to_thread` / `run_in_executor` / `functools.partial` / literal `getattr` as the call they make
  (`src/lang/python/lower-calls.ts`), `@property` clients, FastAPI `Depends` (`src/lang/python/depends.ts`, the
  `injection` hook) and factories returning one of several SDKs' clients (`Chain.alternatives`); TypeScript follows
  lazily assigned `let` clients (`src/ast/assigned.ts`).
- Go: `net/http` (and go-retryablehttp, fhttp), Resty and the go-openai, openai-go, anthropic-sdk-go and genai registries
  are done (`docs/languages.md#go`, limitations there).
- Shell: curl, wget and HTTPie command lines are done (`docs/languages.md#shell`, limitations there).
- Rust: reqwest, ureq, awc, surf, isahc and the async-openai, openai-api-rs, teloxide and serenity registries are done
  (`docs/languages.md#rust`, limitations there).
- Jupyter notebooks (Python's `readText`) and Vue, Svelte and Astro components (the TypeScript front end) are read.
- Next language candidates (Dart first by production weight, Ruby, C#) and what each needs are listed at the end of
  `docs/languages.md`.
