import type { Part } from "../../types.js";
import type { Found } from "./extract.js";
import type { ShellRequest } from "./request.js";

/** An env read the sourced files assign instead (the last one to assign it wins, as when they run in order). */
function substitute(parts: Part[], sourced: Map<string, Part[]>[]): Part[] {
  return parts.flatMap((p) => {
    if (p.kind !== "env") return [p];
    const value = [...sourced].reverse().find((e) => e.has(p.name))?.get(p.name);
    return value ?? [p];
  });
}

function requestWith(req: ShellRequest, sourced: Map<string, Part[]>[]): ShellRequest {
  const sub = (parts: Part[]): Part[] => substitute(parts, sourced);
  return {
    ...req,
    url: sub(req.url),
    method: req.method && sub(req.method),
    headers: req.headers.map(sub),
    data: req.data.map((d) => ({ ...d, parts: sub(d.parts), file: d.file && sub(d.file) })),
    form: req.form.map((f) => ({ ...f, value: sub(f.value) })),
    query: req.query.map(sub),
  };
}

/** Requests whose env reads the files a script sources (`source ./config.sh`) assign, one level deep. */
export function withSourced(found: Found[], sourced: Map<string, Part[]>[]): Found[] {
  if (sourced.length === 0) return found;
  return found.map((f) => ({ ...f, req: requestWith(f.req, sourced) }));
}
