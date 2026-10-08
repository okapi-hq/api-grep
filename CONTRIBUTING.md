# Contributing

Thanks for your interest in `apicalls`. Bug reports, missed or false calls, new SDK registries
and documentation fixes are all welcome.

## Reporting a missed or wrong call

Open an issue with a **minimal TypeScript snippet** that reproduces it, the command you ran,
and what you expected to see. A snippet of a few lines is far more useful than a link to a
large repository. Never paste code, hosts or credentials from a private codebase: rewrite the
pattern with invented names.

## Development setup

Requires Node.js 20+ and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev scan tests/fixtures/fetch   # run the CLI from source
pnpm test                            # vitest: fixture snapshots and unit tests
pnpm lint                            # eslint, zero warnings allowed
pnpm typecheck
pnpm build                           # tsup -> dist/
```

A Husky pre-commit hook runs lint-staged, the type checker and the tests.

## Project layout

| path | role |
|---|---|
| `src/detect/` | finds call sites: fetch, axios, got/ky, node http, SDKs, framework helpers |
| `src/detect/registry/` | JSON registries mapping SDK member chains to endpoints |
| `src/resolve/` | resolves URLs, methods, query, headers and bodies to templates and shapes |
| `src/wrappers/` | one-hop expansion of local HTTP wrapper functions |
| `src/normalize/` | path templates and provider names |
| `src/validate/` | OpenAPI spec loading, operation matching and shape checks |
| `src/examples/` | synthesized example requests |
| `src/report/` | report schema, JSON, table and curl output, diagnostics, secret redaction |
| `tests/fixtures/` | small fake projects scanned by `tests/fixtures.test.ts` |
| `tests/unit/` | unit tests per module |
| `eval/` | evaluation harness over open-source repositories |

## Tests

- Every detection or resolution change needs a fixture. Add a file under the relevant
  `tests/fixtures/<group>/` folder and assert on it in `tests/fixtures.test.ts` with
  `at(report, "<file>", <line>)`.
- Negative cases (code that must **not** be reported) go in `tests/fixtures/negatives/`.
- Fixtures are written from scratch with invented names and only public provider hosts.
- Snapshots are part of the review. After an intended change, update them with
  `pnpm vitest run -u` and check the diff.

## Adding an SDK registry

1. Create `src/detect/registry/<sdk>.json`:

   ```json
   {
     "package": "openai",
     "provider": "openai",
     "host": "api.openai.com",
     "auth": "bearer",
     "generatedFrom": "manual",
     "instance": { "names": ["default", "OpenAI"] },
     "methods": {
       "chat.completions.create": { "method": "POST", "path": "/v1/chat/completions", "bodyArg": 0 },
       "files.retrieve": { "method": "GET", "path": "/v1/files/{file_id}", "pathArgs": [0] }
     }
   }
   ```

   Each key in `methods` is the member chain after the client instance. `bodyArg`, `queryArg`
   and `pathArgs` give the argument positions; `pathFromBody` takes path parameters from body
   properties; `encoding` sets the body encoding (`form`, `multipart` or `raw`; JSON otherwise). A
   method can also set its own `host` and `auth`, read its body from a property of an argument
   (`bodyProp`), and name where each path placeholder comes from in `params`: `arg:N`,
   `instance:N` (the builder it is called on, `from(table)`) or `ref:N` (a Firebase reference).
   With `inlinePathLiterals`, literal values are written into the path; `instance.urlArg` names
   the constructor argument that holds the base URL. An alias ending in `/*` covers a whole
   scope (`@sentry/*`). See `MethodSpec` and `RegistryEntry` in [`src/types.ts`](src/types.ts)
   for every field.
2. Register it in `defaultRegistry()` in [`src/detect/registry/index.ts`](src/detect/registry/index.ts).
3. Add a fixture in `tests/fixtures/sdk/`. If detection relies on the package's types, add the
   SDK as a dev dependency.

`pnpm gen:registry stripe|openai` regenerates those two registries from the vendor OpenAPI
specs (network access required). Review the diff before committing.

## Code style

- TypeScript, ESM, strict mode.
- ESLint enforces at most 300 lines per file and 50 lines per function. Split code rather than
  disabling the rule.
- Keep the scanner static: no network calls, no code execution, no AI.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep each pull request to one topic, with tests.
3. Make sure `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass. CI runs the same
   checks.
4. Explain *why* in the description, and include before/after output when the report changes.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
