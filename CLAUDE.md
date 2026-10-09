# CLAUDE.md

Guidance for AI agents working in this repository. Human-facing docs: [README.md](README.md),
[CONTRIBUTING.md](CONTRIBUTING.md), [docs/languages.md](docs/languages.md) (architecture, per-language status, plan),
[docs/sdk-support.md](docs/sdk-support.md) (generated SDK matrix).

## What this is

`apicalls` (repository `api-grep`) statically lists the outbound HTTP and SDK calls of a repository: provider, method,
path template, body / query / header shapes, auth scheme, confidence. Supported languages: TypeScript and Python; PHP is
planned next (see the plan in `docs/languages.md`). It must stay static: no network, no code execution, no AI.

## Commands

```sh
pnpm install
pnpm dev scan <dir> [--json] [--language python]   # CLI from source
pnpm test                    # vitest: fixture snapshots, recall check, unit tests
pnpm test:e2e                # builds dist/ and runs the CLI as a subprocess (incl. hostile-repository cases)
pnpm vitest run -u           # update snapshots after an intended change, then review the diff
pnpm lint                    # zero warnings; max 300 lines per file, 50 per function
pnpm typecheck
pnpm build                   # tsup -> dist/, copies tree-sitter grammars to dist/grammars
pnpm gen:schema              # regenerate schema/report.v1.json after a report schema change (bump SCHEMA_VERSION)
pnpm gen:support             # regenerate docs/sdk-support.md after a registry / providers.json change
pnpm gen:stripe-ports        # regenerate ported Stripe registries from src/detect/registry/stripe.json
```

Run lint, typecheck, test and test:e2e before declaring work done; CI runs the same.

## Architecture in one screen

- `src/scan.ts` runs each language in `src/lang/index.ts` and merges calls, diagnostics and coverage.
- A language (`src/lang/types.ts`) returns report `Call`s. Everything after that is shared: specs, examples, schema
  check, redaction, stats, diagnostics, coverage. `src/assemble.ts` builds the `Call` (provider, confidence, id) for
  every language.
- TypeScript: `src/lang/typescript/` wraps the ts-morph pipeline in `src/detect`, `src/resolve`, `src/wrappers`.
- Tree-sitter languages: `src/lang/<lang>/lower*.ts` turns the syntax tree into the IR of `src/lang/ir/model.ts`; the
  engine in `src/lang/ir/` (lookup, chains, evaluation, shapes, SDK and HTTP-table detection, wrappers, build) does the
  rest. A language is mostly data: `clients.json`, `registry/*.json`, manifests, `index.ts`.
- Pure helpers shared by all languages: `src/resolve/{parts,url-shape,header-names,shape-utils,sdk-template}.ts`.
- `src/normalize/providers.json`: provider ids, hosts, and SDK packages per ecosystem (`npm`, `pypi`).
- The report is a versioned contract (`src/report/schema.ts`, `schema/report.v1.json`): new fields or enum values bump
  the minor of `SCHEMA_VERSION`, breaking changes the major. Each call's language is `location.language`.

## Conventions

- Every detection or resolution change needs a fixture (`tests/fixtures/<group>/`, Python under
  `tests/fixtures/python/`). Patterns from real repositories go in a directory with an `expected.json` so the recall
  check (`tests/recall.test.ts`) covers them; write fixtures from scratch with invented names.
- Snapshots are part of the review: never update them blindly.
- A per-file failure is a diagnostic (`diagnostics.skipped` / `droppedCalls`), never a crash.
- `provider` never contains a template (`{...}`).
- The scanned repository is hostile input: files are listed through `src/lang/files.ts` (symlinks must stay inside the
  scanned directory), config files and manifests are read through `readConfigFile()` (`src/files.ts`), keys from the
  code go through `isSafeKey()`, and anything printed goes through `printable()`.
- Registries: TypeScript in `src/detect/registry/`, Python in `src/lang/python/registry/` (format: `IrRegistryEntry` in
  `src/lang/ir/language.ts`). A new registry package must be listed under its provider's `packages.<ecosystem>` in
  `providers.json` (a unit test checks it); then run `pnpm gen:support`.
- Python module names that differ from their PyPI name go in `src/lang/python/modules.json`.
- Comments explain why, briefly; match the surrounding code.

## Where work is tracked

- Open issues #3 to #8 (recall, diagnostics, fixtures, provider roadmap, coverage, provider resolution) are done for
  TypeScript; `docs/languages.md` has a table of how each applies to Python (done) and PHP (planned).
- Next: PHP (lowering, HTTP clients such as Guzzle, Laravel `Http`, Symfony HttpClient, curl, `file_get_contents` and
  WordPress, Packagist registries, Composer manifests), following the plan in `docs/languages.md`.
