# Privacy and untrusted code

## Privacy

Reports describe shapes, not data. Before output, every emitted string is checked against a
denylist (`sk_live_`, `AKIA`, `ghp_`, JWTs, long hex, URLs with `user:password@`) and
secret-looking values are replaced with `<redacted>` and counted in `stats.redacted`. Literal
values of credential-named body properties and query parameters (`password`, `client_secret`,
`api_key`, `accessToken`) are dropped, credentials in a URL (`https://user:pass@host`) never
reach `host` or `urlTemplate`, and credential headers keep their name only.

## Scanning untrusted code

A scanned repository is treated as hostile input:

- Its code is parsed, never run.
- Paths, URLs and values it chooses are printed with control characters escaped, so they cannot
  drive the terminal. `--curl` quotes every value and uses `--data-raw` / `--form-string`, so a
  value such as `@/etc/passwd` is sent as written, never read from disk.
- Symlinks that lead out of the scanned directory are not scanned, nor followed by the
  TypeScript checker once out of the repository root (the scanned directory when it is in no
  git repository), and `package.json`,
  `.env.example` and `tsconfig.json` are read only when they are small regular files.
- The TypeScript checker reads nothing above the repository root (the nearest directory holding
  `.git`), or above the scanned directory when it is in no git repository: imports,
  `/// <reference>` paths, `node_modules` packages, `@types` and the nearest `tsconfig.json`
  resolve inside it only, symlinks included. A subdirectory of a monorepo still reads the sibling
  packages it imports; a package installed above the checkout (a stray `~/node_modules`) is not
  read, so a report does not depend on where the repository is checked out or where the scan
  runs. `--tsconfig` names a tsconfig anywhere.
- `--changed-since` runs `git` in the scanned directory with `core.fsmonitor` off and without
  external diff or textconv drivers. A `.git` directory that arrived with untrusted files (an
  archive, not a clone) can still configure other filters: use it on checkouts you made.
