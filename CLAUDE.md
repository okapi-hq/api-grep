# CLAUDE.md

Guidance for AI agents working in this repository. Human-facing docs: [README.md](README.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [docs/languages.md](docs/languages.md) (architecture, per-language status, plan),
[docs/sdk-support.md](docs/sdk-support.md) (generated SDK matrix).

## What this is

`api-grep` statically lists the outbound HTTP and SDK calls of a repository: provider, method,
path template, body / query / header shapes, auth scheme, and where each part came from. The report states facts only
and leaves any judgement (a score, a verdict) to its consumer. Supported languages: TypeScript, JavaScript, HTML
(inline scripts and forms), Python, PHP, Kotlin and Java (one front end and one index for both: HTTP clients,
Retrofit, Feign and the JVM SDK registries; `docs/languages.md`). It must stay static: no network, no code execution, no AI.

## Commands

```sh
pnpm install
pnpm dev scan <dir> [--json] [--language python,php]   # CLI from source
pnpm dev serve [--port 8080]                           # HTTP server from source (README "HTTP server")
pnpm test                    # vitest: fixture snapshots, recall check, unit tests
pnpm test:e2e                # builds dist/ and runs the CLI as a subprocess (incl. hostile-repository cases)
pnpm vitest run -u           # update snapshots after an intended change, then review the diff
pnpm lint                    # zero warnings; max 300 lines per file, 50 per function
pnpm typecheck
pnpm build                   # tsup -> dist/, copies tree-sitter grammars to dist/grammars
pnpm gen:schema              # regenerate schema/report.v1.json after a report schema change (bump SCHEMA_VERSION)
pnpm gen:support             # regenerate docs/sdk-support.md after a registry / providers.json change
pnpm gen:stripe-ports        # regenerate ported Stripe registries from src/detect/registry/stripe.json
docker build --build-arg API_GREP_COMMIT=$(git rev-parse --short=12 HEAD) -t api-grep .   # the image (serve by default)
```

Run lint, typecheck, test and test:e2e before declaring work done; CI runs the same.

## Architecture in one screen

- `src/scan.ts` runs each language in `src/lang/index.ts` and merges calls, diagnostics and coverage.
- A language (`src/lang/types.ts`) returns report `Call`s. Everything after that is shared: examples, schema check,
  redaction, stats, diagnostics, coverage. `src/assemble.ts` builds the `Call` (provider, id, `optionsOpaque`,
  `bodySource`) for every language.
- TypeScript, JavaScript and HTML: `src/lang/typescript/` wraps the ts-morph pipeline in `src/detect`, `src/resolve`,
  `src/wrappers` (JavaScript through `allowJs`; an HTML page becomes a same-size JavaScript file of its inline scripts,
  see `src/lang/html/`). Memory (#68): `graph.ts` groups the files that can see each other (imports either way,
  `/// <reference>`, `declare module`, globals); `batches.ts` packs groups into projects of about 16 MB of source (a
  smaller repository is one project, without the pre-pass), scanned one after the other (`batched.ts`), results
  merged in single-project order; `checker-budget.ts` drops a project's checker after a fixed count of types or
  instantiations (never on the heap: a report depends on the input only); `src/module-resolution.ts` resolves imports
  without keeping every path tried. A scan of the public eval fits in a 2 GB heap (`pnpm eval` runs with it).
- Tree-sitter languages (Python, PHP, Kotlin, Java): `src/lang/<lang>/lower*.ts` turns the syntax tree into the IR of `src/lang/ir/model.ts`; the
  engine in `src/lang/ir/` (lookup, chains, evaluation, shapes, SDK and HTTP-table detection, wrappers, build) does the
  rest. A language is mostly data: `clients.json`, `registry/*.json`, manifests, `index.ts`. Grammars are listed in
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
- Pure helpers shared by all languages: `src/resolve/{parts,url-shape,url-reference,header-names,shape-utils,sdk-template,string-template}.ts`.
- Keys added to a dict or object after it is built (#38): tree-sitter languages lower `kwargs["k"] = v`, `.update`,
  `del`, `$params['k'] = $v` as `Assign.edit`, and `lookup` folds them in (`src/lang/ir/edits.ts`); TypeScript applies
  them to the shape (`src/resolve/object-edits.ts`, `edited-shape.ts`). Rules in `docs/languages.md`.
- A parameter's values (#39): a body value, model or header that is an unsubstituted parameter reads the literals its
  callers pass (one level) and its default; callers come from `src/lang/ir/param-values.ts` (IR) and
  `src/resolve/param-values.ts` (TypeScript references), merged by `src/resolve/param-shape.ts`; several header values
  go to `Call.headerAlternatives`.
- `src/model/`: the `model` fact of a call (`fact.ts`: argument, body or path) and the routing of libraries that pick
  the provider from the model name (`route.ts`, registries with `routeByModel`, provider `llm-router` until routed).
- `Call.operation` (#30): the operation of protocols that name it outside the URL (JSON-RPC, GraphQL, SOAP, action
  APIs). `assembleCalls` (`src/assemble.ts`) reads it from the resolved request through `src/operation/`, one module
  per protocol (`json-rpc.ts` reads the body shape, `graphql.ts` parses documents with the `graphql` package; an SDK
  method's document argument is `ResolvedCall.document`; a codegen AST document reads as the text it prints to,
  `src/resolve/graphql-ast.ts`, #56; `soap.ts` reads the `SOAPAction` header and the XML
  envelope, `action.ts` the query or form parameter a provider's `operationParam` in `providers.json` names), unless
  the front end set `ResolvedCall.operation`; `callId` hashes its name; a batch is one `Call` per operation. Schema,
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
  `useQueryLoader` and fragment hooks (`sendsThrough`, `refetchQuery`, `src/resolve/relay-refetch.ts`). JSON-RPC client libraries (#52: `@solana/web3.js` and `@solana/kit`, viem, ethers,
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
  (`typechain.ts`), `connect` / `attach` and typed contracts (`contract-forms.ts`), JSON ABIs (`json-abi.ts`).
- SDK clients passed as untyped parameters (#37): `src/lang/ir/receiver.ts` and `src/detect/receiver.ts` follow the
  callers one level up (one call per distinct client), else the one SDK the nearby manifests declare with that method,
  else `diagnostics.unfollowed` `receiver-unknown`; `Call.clientFrom` says which (`docs/languages.md`).
- `src/normalize/providers.json`: provider ids, hosts, and SDK packages per ecosystem (`npm`, `pypi`, `composer`, `maven`).
- `src/server/`: `api-grep serve`. `app.ts` routes and authenticates (`API_GREP_TOKEN`), one scan at a time. Each
  request runs two children through `child.ts` (own process group, deadline, minimal env, no git): the hidden
  `unpack` command (`unpack.ts` over `archive.ts`: files and directories only, limits, strict) and `scan --json`
  (`run-scan.ts`). `src/version.ts`: the version plus `+<API_GREP_BUILD>`.
- The report is a versioned contract (`src/report/schema.ts`, `schema/report.v1.json`): new fields or enum values bump
  the minor of `SCHEMA_VERSION`, breaking changes the major. Each call's language is `location.language`.

## Conventions

- Every detection or resolution change needs a fixture (`tests/fixtures/<group>/`, JavaScript and HTML under
  `tests/fixtures/javascript/` and `tests/fixtures/html/`, Python under `tests/fixtures/python/`, PHP under
  `tests/fixtures/php/`, Kotlin under `tests/fixtures/kotlin/`, Java and mixed Kotlin / Java under `tests/fixtures/java/`). The recall check scans a fixture without its
  subdirectories: a project with a nested layout (an Android app) is checked by its own test instead. Patterns from real repositories go in a directory with an `expected.json` so the recall
  check (`tests/recall.test.ts`) covers them; write fixtures from scratch with invented names.
- Snapshots are part of the review: never update them blindly.
- A per-file failure is a diagnostic (`diagnostics.skipped` / `droppedCalls`), never a crash.
- `provider` never contains a template (`{...}`).
- The scanned repository is hostile input: files are listed through `src/lang/files.ts` (symlinks must stay inside the
  scanned directory), config files and manifests are read through `readConfigFile()` (`src/files.ts`), keys from the
  code go through `isSafeKey()`, and anything printed goes through `printable()`.
- Registries: TypeScript in `src/detect/registry/`, Python in `src/lang/python/registry/`, PHP in
  `src/lang/php/registry/`, Kotlin and Java (JVM) in `src/lang/jvm/registry/` (format: `IrRegistryEntry` in
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
- Next language candidates (Go, Ruby, C#) and what each needs are listed at the end of `docs/languages.md`.
