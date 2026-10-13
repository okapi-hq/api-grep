import type { DiagnosticsCollector } from "../../report/diagnostics.js";
import type { DroppedCall, SkippedFile, UnfollowedCall } from "../../report/schema.js";

/** Where the TypeScript scan reports a file it skipped, a call it did not follow or a call it dropped. */
export type DiagnosticsSink = Pick<DiagnosticsCollector, "skip" | "unfollow" | "drop">;

type Entry = { kind: "skip"; entry: SkippedFile } | { kind: "unfollow"; entry: UnfollowedCall } | { kind: "drop"; entry: DroppedCall };

function sink(list: Entry[]): DiagnosticsSink {
  return {
    skip: (entry) => list.push({ kind: "skip", entry }),
    unfollow: (entry) => list.push({ kind: "unfollow", entry }),
    drop: (entry) => list.push({ kind: "drop", entry }),
  };
}

/**
 * Diagnostics of every batch, handed to the collector at the end in the order a single project gives them: what the
 * detectors reported, file by file, then the calls dropped while building, file by file.
 */
export class DeferredDiagnostics {
  private readonly detected: Entry[] = [];
  private readonly built: Entry[] = [];
  readonly detecting = sink(this.detected);
  readonly building = sink(this.built);

  /** `rank` orders files (paths relative to the scanned directory). */
  flush(diag: DiagnosticsSink, rank: (file: string) => number): void {
    for (const list of [this.detected, this.built]) {
      const sorted = list.map((e, i) => ({ e, i, r: rank(e.entry.file) })).sort((a, b) => a.r - b.r || a.i - b.i);
      for (const { e } of sorted) {
        if (e.kind === "skip") diag.skip(e.entry);
        else if (e.kind === "unfollow") diag.unfollow(e.entry);
        else diag.drop(e.entry);
      }
      list.length = 0;
    }
  }
}
