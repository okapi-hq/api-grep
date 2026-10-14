# Evaluation

- `pnpm eval` scans the open-source repositories of [`repos.json`](repos.json) and writes
  [`results.md`](results.md).
- `pnpm eval:score` scores hand-labeled samples of those reports ([`label/README.md`](label/README.md)).
- `pnpm eval:inventory` compares scans with a reference inventory of call sites and prints the totals of the four
  checks of [#114](https://github.com/okapi-hq/api-grep/issues/114). It is meant for repositories that cannot be
  published: the default output is counts only.

## `pnpm eval:inventory`

```sh
pnpm eval:inventory --repos <dir> --inventory <file> [--manifest <file>] [--out <dir> | --reports <dir>] \
  [--tolerance 3] [--json] [--detail] [--in-process] [--timeout <minutes>]
```

- `--repos <dir>`: one subdirectory per repository, checked out at the commit to evaluate. Every subdirectory is
  scanned, unless `--manifest` lists them: a JSON array shaped like `repos.json` (`name` is the directory under
  `--repos`, optional `subdir` scans part of it, optional `language` scans that language only; `url` is not used).
- `--inventory <file>`: the reference inventory (format below).
- Each repository is scanned by `api-grep scan` from source in a child process with a 2 GB heap, one at a time, so a
  crash or an out-of-memory stops that scan only. `--in-process` calls `scan()` in this process instead, like
  `pnpm eval` (faster; an out-of-memory then stops the run). `--out <dir>` keeps the reports as `<dir>/<name>.json`;
  `--reports <dir>` reads such reports instead of scanning (a missing one counts as a scan that stopped).
- `--tolerance <n>` (default 3): how many lines an inventory entry and a reported call may be apart.
- `--json` prints the same totals as JSON.
- `--detail` adds a line per repository and the call sites it missed. It names repositories and files: keep it
  local, never post it.

The default output names no repository, file, host, environment variable or code: post it as is on #114 and on the
issue of each check.

### Inventory format

CSV with a header row, or JSON (an array of objects, or `{ "entries": [...] }`), one entry per call site:

| column | required | meaning |
|---|---|---|
| `repo` | yes | the repository's directory name under `--repos` |
| `file` | yes | path relative to the repository root (not to a manifest `subdir`), `/` or `\` separated |
| `line` | yes | 1-based line of the call |
| `service` | no | who the call talks to (`stripe`, `supabase`); the repository's own name or `internal` is its own backend |
| `kind` | no | `third-party` or `internal` (also `external`, `first-party`, `own`, `self`, `backend`); wins over `service` |
| `target` | no | a host, an SDK method, a note: never read |

```csv
repo,file,line,service,kind,target
shop-web,src/orders.ts,4,supabase,,orders.select
shop-web,src/api.ts,2,,internal,GET /api/{path}
```

A call made through a helper is one entry, at the line inside the helper that makes the request: api-grep reports
that request there too, so the entry matches it. The calls api-grep adds at each caller of the helper (`via` set,
located at the caller) only match entries the inventory has at those callers. Rows without a repository, a file or a
positive line, and rows of a repository that is not in the run, are counted and left out. The file is read only if
it is a regular file of at most 64 MB.

### What is counted

1. #3, recall: inventory entries matched by a reported call in the same file, at most `--tolerance` lines away. Each
   call matches one entry (two entries on one line need two calls there); the nearest pairs win, and a direct call
   wins over a call at a wrapper's caller. Entries in a file outside a manifest `subdir` count as missed.
2. #4: scans that stopped (no report: exit status other than 0 or 2, a signal, a timeout, an unreadable report)
   against those that wrote a report; among the reports, `diagnostics.complete` true or false, and the entries that
   make it false per reason (`skipped` files that could not be read, `droppedCalls`, `unfollowed`).
3. #7: the `coverage.sdks` status of `@supabase/supabase-js` in the repositories that have an entry for it, and the
   status of every `coverage.sdks` entry.
4. #8: the provider of the matched calls, split into resolved (a provider id), `internal`, `unknown` and `env:*`. A
   matched call is third-party when the inventory says so (`kind`, else `service`); when it says nothing, when the
   report's provider is not `internal`. The bold count, third-party calls still `unknown` or `env:*`, is the one to
   compare with the target of at most 10.
