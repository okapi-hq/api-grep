# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through
[GitHub private vulnerability reporting](https://github.com/okapi-hq/api-grep/security/advisories/new).

Include a description of the issue, steps or a snippet to reproduce it, and its impact. You
should get a first answer within a few days. Fixes are released on `main`, and the report is
credited unless you ask otherwise.

## Scope

`apicalls` reads source code and never executes it or calls the network. Issues of interest
include secrets that leak into reports despite redaction, crashes or resource exhaustion
triggered by a crafted repository, output (table, `--curl`) that a crafted repository can turn
into terminal control sequences or shell commands, and anything that makes a scan run code,
read files outside the scanned directory or open connections. The protections in place are
listed in the README's [Scanning untrusted code](README.md#scanning-untrusted-code) section and
tested in [`tests/e2e/security.e2e.test.ts`](tests/e2e/security.e2e.test.ts).

## Dependencies

CI runs `pnpm audit --prod --audit-level high`. One advisory is ignored in `package.json`
(`pnpm.auditConfig`): [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
in `braces`, reached through `fast-glob`, has no fixed version and only applies to glob
patterns, which come from the user's own `--include` / `--exclude`. Dependabot proposes
dependency and GitHub Actions updates.
