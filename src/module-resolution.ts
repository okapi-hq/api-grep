import { ts, type ResolutionHostFactory } from "ts-morph";

/** The import, export, `require` and `import()` strings of a file, in the order the checker resolves them. */
function usagesOf(file: ts.SourceFile): Map<string, ts.StringLiteralLike[]> {
  const out = new Map<string, ts.StringLiteralLike[]>();
  const all = [...((file as { imports?: readonly ts.StringLiteralLike[] }).imports ?? []), ...((file as { moduleAugmentations?: readonly ts.Node[] }).moduleAugmentations ?? [])];
  for (const u of all) {
    if (!ts.isStringLiteralLike(u)) continue;
    const list = out.get(u.text);
    if (list) list.push(u);
    else out.set(u.text, [u]);
  }
  return out;
}

type Resolution = ts.ResolvedModuleWithFailedLookupLocations & { failedLookupLocations?: string[]; affectingLocations?: string[] };

/**
 * Module resolution that keeps only what it found. The checker's own keeps, for every import, each path it tried
 * (`failedLookupLocations`, for watch mode): in a repository scanned without node_modules that is hundreds of
 * megabytes of paths per project (#68). Results are the same: `ts.resolveModuleName` with the mode of each import and
 * a resolution cache, whose entries lose those lists once read.
 */
export const leanResolution: ResolutionHostFactory = (host, getCompilerOptions) => {
  const cache = ts.createModuleResolutionCache(host.getCurrentDirectory?.() ?? process.cwd(), (f) => f, getCompilerOptions());
  return {
    resolveModuleNames(moduleNames, containingFile, _reused, redirectedReference, options, containingSourceFile) {
      const opts = options ?? getCompilerOptions();
      const usages = containingSourceFile ? usagesOf(containingSourceFile) : new Map<string, ts.StringLiteralLike[]>();
      const seen = new Map<string, number>();
      return moduleNames.map((name) => {
        const k = seen.get(name) ?? 0;
        seen.set(name, k + 1);
        const usage = usages.get(name)?.[k];
        const mode = usage && containingSourceFile ? ts.getModeForUsageLocation(containingSourceFile, usage, opts) : undefined;
        const r = ts.resolveModuleName(name, containingFile, opts, host, cache, redirectedReference, mode) as Resolution;
        // the cache keeps this object: dropping the lists here drops them there
        delete r.failedLookupLocations;
        delete r.affectingLocations;
        return r.resolvedModule;
      });
    },
  };
};
