# HTTP server and Docker image

## HTTP server

`api-grep serve` scans the archives it receives: POST a gzip-compressed tar of a repository, get the JSON report
back. It is the same scan as the command line, run in a child process for each request.

```sh
export API_GREP_TOKEN=$(openssl rand -hex 32)
api-grep serve --host 0.0.0.0 --port 8080
git archive --format=tar.gz --prefix=repo/ HEAD \
  | curl --data-binary @- -H "authorization: Bearer $API_GREP_TOKEN" -H "content-type: application/gzip" \
    "http://localhost:8080/v1/scan?examples=1"
```

| route | answer |
|---|---|
| `POST /v1/scan` | the report (`200`, a partial scan included) for the archive in the body. Query: `language` (as `--language`), `examples` (0 to 20). A `Server-Timing` header gives the unpack and scan times |
| `GET /v1/health` | `status`, `version`, `schemaVersion` and whether a scan is running. The only route without the token |

Errors are JSON, `{ "error": { "code", "message" } }`: `400` bad query, `401` missing or wrong token, `413` archive
over a limit, `415` not `application/gzip`, `422` not a readable archive or an unsafe entry, `429` a scan is already
running (one at a time; `Retry-After` is set), `500` the scan failed, `504` the scan timed out.

An archive with a single top-level directory (`git archive --prefix`, a GitHub tarball) is scanned from that
directory. The archive is untrusted: only regular files and directories are unpacked (no link, device or `.git`),
an absolute or `..` path or a corrupt archive fails the request, and nothing of it stays on disk after the answer.
Unpacking and scanning each run in a child process that gets none of the server's environment variables and never
runs git; a refused archive, a client that goes away or a stopping server (SIGTERM) kills it before its files are
removed. Without a token the server only answers requests addressed to `localhost`.

| variable | default | |
|---|---|---|
| `API_GREP_TOKEN` | none | bearer token of every route but health; required to listen beyond loopback, at least 16 characters |
| `API_GREP_HOST`, `API_GREP_PORT` | `127.0.0.1`, `8080` (or `PORT`) | address and port; `--host` and `--port` win |
| `API_GREP_MAX_ARCHIVE_MB` | 512 | largest request body |
| `API_GREP_MAX_UNPACKED_MB`, `API_GREP_MAX_FILES` | 2048, 200000 | largest unpacked size and entry count of one archive |
| `API_GREP_SCAN_TIMEOUT_S` | 900 | the scan process is killed after it |
| `API_GREP_MAX_REPORT_MB` | 256 | largest report |
| `API_GREP_HEAP_MB` | 8192 | heap of each scan process; keep it below the memory the server has |

Logs give the route, status and duration of each request, never a path or a value from an archive.

## Docker

The image runs `api-grep serve` on port 8080 by default, and any other command when given one:

```sh
docker run --rm -p 8080:8080 -e API_GREP_TOKEN=<16+ characters> ghcr.io/okapi-hq/api-grep
docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo --json
```

Tags: `main` follows the main branch; `X.Y.Z`, `X.Y`, `X` and `latest` are releases. Releases are automatic: every
push to main whose commits call for one (`fix:` a patch, `feat:` a minor, a breaking change a major) is tagged
`vX.Y.Z`, released on GitHub with its notes, and published. The version an image reports is
`<version>+<commit>` (`1.4.0+f71db3312345`), the latest release and the commit built, so every report names the exact
code that wrote it; the same comes from `API_GREP_BUILD` outside Docker. A build from source reports
`0.0.0-development`. `docker build --build-arg API_GREP_COMMIT=$(git rev-parse --short=12 HEAD) .` builds it locally.
