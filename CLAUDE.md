# CLAUDE.md

Guidance for AI agents working in this repository. Human-facing docs: [README.md](README.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [docs/languages.md](docs/languages.md) (architecture, per-language status, plan),
[docs/sdk-support.md](docs/sdk-support.md) (generated SDK matrix).

## What this is

`api-grep` statically lists the outbound HTTP and SDK calls of a repository: provider, method,
path template, body / query / header shapes, auth scheme, and where each part came from. The report states facts only
and leaves any judgement (a score, a verdict) to its consumer. Supported languages: TypeScript, JavaScript, HTML
(inline scripts and forms), Python, PHP and Kotlin (HTTP clients; Retrofit #31 and SDK registries #33 next), Java
with #43 (`docs/languages.md`). It must stay static: no network, no code execution, no AI.

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
  see `src/lang/html/`).
- Tree-sitter languages (Python, PHP, Kotlin): `src/lang/<lang>/lower*.ts` turns the syntax tree into the IR of `src/lang/ir/model.ts`; the
  engine in `src/lang/ir/` (lookup, chains, evaluation, shapes, SDK and HTTP-table detection, wrappers, build) does the
  rest. A language is mostly data: `clients.json`, `registry/*.json`, manifests, `index.ts`. Grammars are listed in
  `src/lang/grammars.ts`. JVM manifests (Gradle, version catalogs, `pom.xml`), Maven package roots and `BuildConfig`
  values are in `src/lang/jvm/`, shared with Java later; so are the JVM HTTP clients (`src/lang/jvm/http/`: OkHttp and
  its interceptors, `java.net.http`, Ktor, Spring, Feign), detectors over the IR driven by `clients.json`, with the
  engine's builder steps (`ir/steps.ts`), entry-by-entry values (`ir/fluent.ts`) and header / query pairs
  (`ir/pairs.ts`, `Call.clientParts` for those an interceptor or a client default adds).
- Pure helpers shared by all languages: `src/resolve/{parts,url-shape,header-names,shape-utils,sdk-template}.ts`.
- `src/model/`: the `model` fact of a call (`fact.ts`: argument, body or path) and the routing of libraries that pick
  the provider from the model name (`route.ts`, registries with `routeByModel`, provider `llm-router` until routed).
- `Call.operation` (#30): the operation of protocols that name it outside the URL (JSON-RPC, GraphQL, SOAP, action
  APIs). Front ends set `ResolvedCall.operation`; `callId` hashes its name; a batch is one `Call` per operation. Schema,
  batch decision and per-protocol status (#34 to #36) in `docs/languages.md`.
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
  `tests/fixtures/php/`, Kotlin under `tests/fixtures/kotlin/`). The recall check scans a fixture without its
  subdirectories: a project with a nested layout (an Android app) is checked by its own test instead. Patterns from real repositories go in a directory with an `expected.json` so the recall
  check (`tests/recall.test.ts`) covers them; write fixtures from scratch with invented names.
- Snapshots are part of the review: never update them blindly.
- A per-file failure is a diagnostic (`diagnostics.skipped` / `droppedCalls`), never a crash.
- `provider` never contains a template (`{...}`).
- The scanned repository is hostile input: files are listed through `src/lang/files.ts` (symlinks must stay inside the
  scanned directory), config files and manifests are read through `readConfigFile()` (`src/files.ts`), keys from the
  code go through `isSafeKey()`, and anything printed goes through `printable()`.
- Registries: TypeScript in `src/detect/registry/`, Python in `src/lang/python/registry/`, PHP in
  `src/lang/php/registry/` (format: `IrRegistryEntry` in `src/lang/ir/language.ts`). A new registry package must be listed under its provider's `packages.<ecosystem>` in
  `providers.json` (a unit test checks it); then run `pnpm gen:support`.
- Python module names that differ from their PyPI name go in `src/lang/python/modules.json`; PHP namespaces per
  Composer package in `src/lang/php/namespaces.json`; Java / Kotlin package roots of a Maven `group:artifact` that are
  not its group id in `src/lang/jvm/packages.json`.
- The server's archives are hostile input too: never write anything but regular files and directories, never log a
  path, a query value or anything from an archive, and never pass the server's environment to a scan.
- Comments explain why, briefly; match the surrounding code.

## Where work is tracked

- Issues #3 to #8 (recall, diagnostics, fixtures, provider roadmap, coverage, provider resolution) apply to every
  language; `docs/languages.md` has a table of how each is covered in TypeScript, Python and PHP.
- Kotlin: #29 (parsing, lowering, manifests) and #32 (OkHttp with interceptors, `java.net.http`, Ktor, Spring, Feign)
  are done; Retrofit #31 (reads `.client(okHttp)` through `okHttpClientFacts`), JVM SDK registries #33, Java #43.
- Next language candidates (Go, Ruby, Java, C#) and what each needs are listed at the end of `docs/languages.md`.
