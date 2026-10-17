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
 * a resolution cache, whose entries lose those lists once read. `optionsFor` gives a file the path aliases of its own
 * package in a monorepo (`nested-aliases.ts`); each set of options has a cache of its own.
 */
export function leanResolutionWith(optionsFor?: (file: string) => ts.CompilerOptions | undefined): ResolutionHostFactory {
  return (host, getCompilerOptions) => {
    const cwd = host.getCurrentDirectory?.() ?? process.cwd();
    const shared = ts.createModuleResolutionCache(cwd, (f) => f, getCompilerOptions());
    const caches = new Map<ts.CompilerOptions, ts.ModuleResolutionCache>();
    const cacheFor = (o: ts.CompilerOptions): ts.ModuleResolutionCache => {
      let c = caches.get(o);
      if (!c) caches.set(o, (c = ts.createModuleResolutionCache(cwd, (f) => f, o)));
      return c;
    };
    return {
      resolveModuleNames(moduleNames, containingFile, _reused, redirectedReference, options, containingSourceFile) {
        const nested = optionsFor?.(containingFile);
        const opts = nested ?? options ?? getCompilerOptions();
        const cache = nested ? cacheFor(nested) : shared;
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
}

export const leanResolution: ResolutionHostFactory = leanResolutionWith();
