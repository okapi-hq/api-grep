import { z } from "zod/v4";

/** What the scan could not read, and the API SDKs it saw: the parts of a report that are about the scan, not a call. */

export const EcosystemSchema = z
  .enum(["npm", "pypi"])
  .meta({ id: "Ecosystem", description: "Package registry of an SDK: npm (package.json), pypi (requirements files, pyproject.toml, Pipfile, setup.cfg / setup.py)." });

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
      .enum(["injected-fetch", "injected-client", "wrapper-depth"])
      .describe(
        "injected-fetch: a fetch function received from outside (`this.fetchFn(url)`). injected-client: an HTTP client object received without a type that names it (`self.session.post(url)`). wrapper-depth: a wrapper three or more hops from its HTTP call.",
      ),
    expr: z.string().optional().describe("The callee expression, for injected-fetch and injected-client."),
    via: z.string().optional().describe("The wrapper called, for wrapper-depth."),
  })
  .meta({ id: "UnfollowedCall", description: "A call site the scan saw but could not follow to a request." });

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
    complete: z.boolean().describe("False when something was lost that was not asked for: an unreadable file, a dropped call or a call not followed."),
  })
  .meta({ id: "Diagnostics", description: "What the scan could not read, so a partial report never looks complete." });

export const SdkCoverageSchema = z
  .object({
    package: z.string().describe("Package name in its ecosystem: an npm package, a PyPI distribution."),
    ecosystem: EcosystemSchema,
    provider: z.string().describe("Provider id the package talks to."),
    supported: z.boolean().describe("An SDK registry exists for the package, so its calls can be listed."),
    declared: z
      .boolean()
      .describe("Declared in a manifest the scan covered: `dependencies` / `peerDependencies` of a package.json, a requirements file, pyproject.toml, Pipfile, setup.cfg or setup.py."),
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

export const CoverageSchema = z
  .object({ sdks: z.array(SdkCoverageSchema) })
  .meta({ id: "Coverage", description: "API SDKs the repository declares or imports. Absent for --changed-since scans." });

export type Ecosystem = z.infer<typeof EcosystemSchema>;
export type Diagnostics = z.infer<typeof DiagnosticsSchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type SdkCoverage = z.infer<typeof SdkCoverageSchema>;
export type SkippedFile = z.infer<typeof SkippedFileSchema>;
export type DroppedCall = z.infer<typeof DroppedCallSchema>;
export type UnfollowedCall = z.infer<typeof UnfollowedCallSchema>;
