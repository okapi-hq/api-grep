import type { SourceFile } from "ts-morph";
import type { BuildCtx } from "../../build-call.js";
import { ReceiverResolver } from "../../detect/receiver.js";
import type { Registry } from "../../detect/registry/index.js";
import { selectChanged } from "../../git.js";
import type { HostLiterals } from "../../hosts/literals.js";
import { loadBatch, type Scope, type Unreadable } from "../../project.js";
import type { Call } from "../../report/schema.js";
import { setDocumentRoot } from "../../resolve/graphql-source.js";
import { importedPackages } from "./coverage.js";
import { DeferredDiagnostics } from "./deferred.js";
import { collectHostLiterals } from "./host-literals.js";
import { buildAll, detectAll } from "./detect-all.js";

export interface BatchCtx {
  scope: Scope;
  registry: Registry;
  build: BuildCtx;
  wrappers: boolean;
  changed?: Set<string>;
  /** npm packages declared by the manifests around a file. */
  declared: (file: string) => Set<string>;
  groupOf: (file: string) => number | undefined;
  /** Rank of each file in scope in a single project: a batch reads its files in that order. */
  order: Map<string, number>;
  hosts?: HostLiterals;
}

const paths = (files: SourceFile[]): string[] => files.map((sf) => sf.getFilePath() as string);

/**
 * What the batches of a scan found. Each batch has a project of its own, dropped once its calls are built: only plain
 * data (calls, diagnostics, imported packages) outlives it.
 */
export class Merged {
  readonly calls: Call[] = [];
  /** Files the batches loaded to scan (absolute paths). */
  readonly loaded: string[] = [];
  /** Those a --changed-since scan kept. */
  readonly selected: string[] = [];
  readonly scanned: string[] = [];
  readonly unreadable: Unreadable[] = [];
  /** npm packages each scanned file imports. */
  readonly imports = new Map<string, Set<string>>();
  readonly log = new DeferredDiagnostics();

  scanBatch(files: string[], ctx: BatchCtx): void {
    const loaded = loadBatch(ctx.scope, files);
    setDocumentRoot(loaded.project, ctx.scope.dir);
    this.unreadable.push(...loaded.unreadable);
    const rank = (sf: SourceFile): number => ctx.order.get(sf.getFilePath()) ?? Number.MAX_SAFE_INTEGER;
    // a file in scope is scanned by its own batch (with the files that see it); a file of the scanned directory out of
    // scope that a batch imports (a minified script) by the first batch importing it
    const mine = new Set(files);
    const done = new Set(this.loaded);
    const isOwn = (p: string): boolean => mine.has(p) || (!ctx.order.has(p) && !done.has(p));
    const own = loaded.files.filter((sf) => isOwn(sf.getFilePath())).sort((a, b) => rank(a) - rank(b));
    this.loaded.push(...paths(own));
    const selected = ctx.changed ? selectChanged(own, ctx.changed) : own;
    this.selected.push(...paths(selected));
    const receivers = new ReceiverResolver(selected, ctx.registry, ctx.declared, ctx.groupOf);
    const { raws, scanned } = detectAll(selected, { rootDir: ctx.scope.dir, registry: ctx.registry, receivers, wrappers: ctx.wrappers, diag: this.log.detecting });
    this.calls.push(...buildAll(raws, ctx.build, this.log.building));
    for (const sf of scanned) {
      this.scanned.push(sf.getFilePath());
      if (!ctx.changed) this.imports.set(sf.getFilePath(), importedPackages(sf));
      if (ctx.hosts) collectHostLiterals(sf, ctx.scope.dir, ctx.hosts);
    }
  }
}
