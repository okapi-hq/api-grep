# Labels

One CSV per repo, produced by `pnpm eval:score sample <repo> 100` and filled by hand.

| column | values | meaning |
|---|---|---|
| `is_call` | `y` / `n` | the location really performs an outbound HTTP/SDK call |
| `provider_ok` | `y` / `n` | provider is right (blank if `is_call=n`) |
| `path_ok` | `y` / `n` | method + path template are right |
| `body_ok` | `y` / `partial` / `n` / `na` | body shape names + types are right |
| `notes` | free text | what went wrong |

For recall, spend 30 minutes grepping two packages for calls the tool missed and list them
one per line in `<repo>.missed.txt` (`file:line reason`). `pnpm eval:score` prints precision
per field and per confidence bucket, and recall when a missed file exists.
