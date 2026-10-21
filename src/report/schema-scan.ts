import { z } from "zod";
import { McpToolRefsSchema } from "./schema-tool-refs.js";

/** What the scan could not read, and the API SDKs it saw: the parts of a report that are about the scan, not a call. */

export const LanguageSchema = z
  .enum(["typescript", "javascript", "html", "python", "php", "kotlin", "java", "go", "shell", "rust", "dart", "mcp-config"])
  .meta({
    id: "Language",
    description:
      "Source language of a file, from its extension. The TypeScript checker reads typescript, javascript and the inline scripts and forms of html files; the tree-sitter front ends read python, php, go, rust, dart, and kotlin and java together (one front end, so names resolve across the two); shell is sh, bash and zsh scripts (`.sh`, `.bash`, `.zsh`, or no extension and a shell `#!` line); mcp-config (since 1.28.0) is the MCP configuration files of coding agents and editors (`.mcp.json`, `mcp.json`, `claude_desktop_config.json`, `mcp_config.json`, `cline_mcp_settings.json`, `.gemini/settings.json`, `opencode.json(c)`, `.codex/config.toml`, `.zed/settings.json`).",
  });

export const EcosystemSchema = z
  .enum(["npm", "pypi", "composer", "maven", "go", "cargo", "pub"])
  .meta({
    id: "Ecosystem",
    description:
      "Package registry of an SDK: npm (package.json), pypi (requirements files, pyproject.toml, Pipfile, setup.cfg / setup.py), composer (composer.json), maven (`group:artifact` coordinates from Gradle build scripts, Gradle version catalogs and pom.xml), go (module paths from go.mod `require` directives), cargo (crates.io names from Cargo.toml `[dependencies]`, per-target dependencies and workspace dependencies), pub (pub.dev package names from pubspec.yaml `dependencies`).",
  });

export const SkippedFileSchema = z
  .object({
    file: z.string().describe("Path relative to the scanned directory."),
    reason: z
      .enum(["parse-error", "internal-error", "excluded", "not-included"])
      .describe("parse-error / internal-error: the file could not be read. excluded / not-included: left out by --exclude / --include."),
    detail: z.string().optional().describe("First line of the error, when there is one."),
  })
  .meta({ id: "SkippedFile", description: "A source file in scope that was not scanned." });

export const DroppedCallSchema = z
  .object({
    file: z.string(),
    line: z.number(),
    reason: z.enum(["schema-invalid", "internal-error"]).describe("schema-invalid: the call did not fit this schema. internal-error: the resolver threw."),
    detail: z.string().optional().describe("For schema-invalid, the failing property path and message."),
  })
  .meta({ id: "DroppedCall", description: "A call that was found but left out of `calls`." });

export const UnfollowedCallSchema = z
  .object({
    file: z.string(),
    line: z.number(),
    reason: z
      .enum(["injected-fetch", "injected-client", "wrapper-depth", "receiver-unknown", "graphql-limit", "host-table-limit"])
      .describe(
        "injected-fetch: a fetch function received from outside (`this.fetchFn(url)`). injected-client: an HTTP client object received without a type that names it (`self.session.post(url)`). wrapper-depth: a call site more than six wrappers away from its HTTP call (four in the languages read with tree-sitter). receiver-unknown: an SDK method called on an untyped parameter (`client.messages.create(...)`) that no caller in the repository passes a known client to, and that several or none of the SDKs the manifests declare have. graphql-limit: a call whose GraphQL document was read past a bound; it is reported with the name and type the document's header gives, and without `operation.fields` (past `operations`, without a name). host-table-limit: a call whose base URL is picked from a table of more than 20 entries; it is reported once, as the scan reads it without the table (often with an unknown host).",
      ),
    expr: z.string().optional().describe("The callee expression, for injected-fetch, injected-client and receiver-unknown."),
    via: z.string().optional().describe("The wrapper called, for wrapper-depth."),
    detail: z
      .string()
      .optional()
      .describe(
        "For host-table-limit, the table's size (`50 candidates (at most 20)`). For graphql-limit, the bound reached: document-size (over 100,000 characters), document-parts (built from over 1,000 parts), tokens (over 50,000 parser tokens), depth (selection sets over 32 deep), fragment-expansion (over 20,000 selection sets visited inlining fragments), fields (over 2,000 field paths), operations (over 50 operations in one request), ast-size, ast-nodes, ast-nesting (a document written as its AST over 4,000,000 characters, 200,000 values or 128 levels of nesting).",
      ),
  })
  .meta({ id: "UnfollowedCall", description: "A call site the scan saw but could not follow to a request, or a call whose GraphQL document it could not fully read." });

export const DiagnosticsSchema = z
  .object({
    filesSeen: z.number().describe("Source files in scope. Test files, mocks, declarations and build output are out of scope."),
    filesScanned: z.number(),
    skipped: z.array(SkippedFileSchema).describe("Files left out. Above 200, files left out by --exclude / --include are only counted in `skippedCounts`."),
    skippedCounts: z.record(z.string(), z.number()).describe("Skipped files per reason."),
    droppedCalls: z.array(DroppedCallSchema),
    unfollowed: z.array(UnfollowedCallSchema),
    languages: z
      .record(z.string(), z.object({ filesSeen: z.number(), filesScanned: z.number() }))
      .describe("Files seen and scanned per language, for the languages with files in scope."),
    complete: z
      .boolean()
      .describe("False when something was lost that was not asked for: an unreadable file, a dropped call, a call not followed or a GraphQL document not fully read."),
  })
  .meta({ id: "Diagnostics", description: "What the scan could not read, so a partial report never looks complete." });

export const SdkCoverageSchema = z
  .object({
    package: z.string().describe("Package name in its ecosystem: an npm package, a PyPI distribution, a Composer package, a Maven `group:artifact`."),
    ecosystem: EcosystemSchema,
    provider: z.string().describe("Provider id the package talks to."),
    supported: z.boolean().describe("An SDK registry exists for the package, so its calls can be listed."),
    declared: z
      .boolean()
      .describe(
        "Declared in a manifest the scan covered: `dependencies` / `peerDependencies` of a package.json, a requirements file, pyproject.toml, Pipfile, setup.cfg or setup.py, `require` of a composer.json, the dependencies of a Gradle build script (test configurations aside) or of a pom.xml (test scope aside).",
      ),
    imported: z.boolean(),
    importSites: z.number().describe("Scanned files that import the package (type-only imports aside)."),
    calls: z.number().describe("Calls in `calls` made through this package."),
    status: z
      .enum(["ok", "unsupported", "imported-no-calls", "declared-not-imported"])
      .describe(
        "ok: supported and calls found. unsupported: imported, no registry (its calls are missed). imported-no-calls: supported but no call found (a wrapper, or a detection bug). declared-not-imported: likely unused.",
      ),
  })
  .meta({ id: "SdkCoverage", description: "An API SDK the repository uses, compared with the calls found through it." });

export const UnexplainedHostSchema = z
  .object({
    host: z.string().describe("The host, lower case, without port."),
    files: z.number().describe("Scanned files whose string literals name it."),
    literals: z.number().describe("String literals naming it (a literal holding two URLs to it counts twice)."),
    language: LanguageSchema.describe("Language of the first file naming it."),
    first: z
      .object({ file: z.string().describe("Path relative to the scanned directory."), line: z.number().describe("1-based line of the URL.") })
      .describe("The first place it is named, by file path, then line."),
  })
  .meta({ id: "UnexplainedHost", description: "An API-looking host the code names that no reported call has: where api-grep likely misses calls." });

export const HostCoverageSchema = z
  .object({
    named: z
      .number()
      .describe(
        "Distinct API-looking hosts named by the string literals (template strings and f-strings included, comments and docstrings aside) of the scanned files: a known provider host, a first label `api`, `api-*` or `*-api`, an LLM gateway, or a URL whose path looks like an API (`/v1/`, `/v2beta/`, `/api/`, `/graphql`, `/rest/`, `/bot{token}/`). Internal, loopback, placeholder, documentation, package registry, schema, asset and repository-link hosts are not counted.",
      ),
    explained: z.number().describe("Of `named`, the hosts that are the host of at least one call in `calls` (case and port aside; a host template such as `{project}.supabase.co` explains the hosts it matches)."),
    unexplained: z
      .array(UnexplainedHostSchema)
      .describe("The named hosts no call explains, by `files` (most first), then host; at most 200 (`named - explained` counts them all)."),
  })
  .meta({
    id: "HostCoverage",
    description:
      "API-looking hosts the scanned code names, compared with the hosts of the calls found: a recall proxy per scan. SDK calls to a default host leave no literal, and files of languages api-grep does not read are not counted.",
  });

export const CoverageSchema = z
  .object({
    sdks: z.array(SdkCoverageSchema),
    hosts: HostCoverageSchema.optional().describe("Hosts the code names compared with the calls' hosts. Present on every full scan since 1.21.0."),
    mcpToolRefs: McpToolRefsSchema.optional().describe("MCP tool names the repository's files pin. Present on every full scan since 1.29.0."),
  })
  .meta({
    id: "Coverage",
    description: "API SDKs the repository declares or imports, API hosts its code names and MCP tool names its files pin. Absent for --changed-since scans.",
  });

export type Ecosystem = z.infer<typeof EcosystemSchema>;
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type SdkCoverage = z.infer<typeof SdkCoverageSchema>;
export type HostCoverage = z.infer<typeof HostCoverageSchema>;
export type UnexplainedHost = z.infer<typeof UnexplainedHostSchema>;
export type SkippedFile = z.infer<typeof SkippedFileSchema>;
export type DroppedCall = z.infer<typeof DroppedCallSchema>;
export type UnfollowedCall = z.infer<typeof UnfollowedCallSchema>;
export * from "./schema-tool-refs.js";
