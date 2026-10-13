import type { Expr, Pos } from "../ir/model.js";

/**
 * A class or type as written (`OkHttpClient`, `okhttp3.OkHttpClient`, `Outer.Inner`): a qualified name when it starts
 * with a package (lower case by convention), else a name and its members, looked up like any name.
 */
export function pathRef(path: string[], pos: Pos): Expr {
  if (path.length > 1 && /^[a-z]/.test(path[0]!)) return { k: "qname", path, pos };
  let e: Expr = { k: "name", name: path[0]!, pos };
  for (const p of path.slice(1)) e = { k: "attr", obj: e, name: p, pos };
  return e;
}
