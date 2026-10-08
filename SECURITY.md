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
triggered by a crafted repository, and anything that makes a scan run code or open
connections.
