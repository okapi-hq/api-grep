import type { Part } from "../../types.js";
import { argOf } from "./args.js";
import { evaluate } from "./evaluate.js";
import type { IrCtx, Seg } from "./raw.js";

/**
 * A segment as the URL names it: its own name, a call standing for its argument 0, or what the language's
 * `pathSegment` hook says for the source's `rule` (msgraph-sdk: `send_mail` is `sendMail`, `by_user_id(u)` is `u`);
 * undefined when the path as a whole cannot be read.
 */
function segmentParts(segs: Seg[], i: number, rule: string | undefined, ctx: IrCtx): Part[] | undefined {
  const s = segs[i]!;
  const named = rule ? ctx.idx.lang.pathSegment?.(rule, s.name, !!s.call, segs[i - 1]?.name ?? "") : s.call ? 0 : s.name;
  if (named === null) return undefined;
  if (typeof named === "string") return [{ kind: "static", text: named }];
  // a segment the rule does not know: a value the scan cannot read, named after it
  if (named === undefined) return [{ kind: "dynamic", name: s.name, origin: "unknown" }];
  const arg = argOf(s, named);
  return arg ? evaluate(arg.expr, arg.fn, ctx) : undefined;
}

/**
 * The names of the chain's segments after the last one named `after`, joined with `/`, a call among them standing for
 * its argument 0 (sendgrid-python `client.suppression.bounces._(email)` -> `suppression/bounces/{email}`), or named by
 * the language's `rule` (`segs:<after>:<rule>`).
 */
export function segmentPath(before: Seg[], after: string, rule: string | undefined, ctx: IrCtx): { parts?: Part[] } {
  const from = before.map((s) => s.name).lastIndexOf(after);
  const segs = from >= 0 ? before.slice(from + 1) : [];
  const pieces = segs.map((_, i) => segmentParts(segs, i, rule, ctx));
  if (pieces.length === 0 || pieces.some((p) => !p)) return {};
  return { parts: pieces.flatMap((p, i) => [...(i ? [{ kind: "static", text: "/" } as Part] : []), ...p!]) };
}
