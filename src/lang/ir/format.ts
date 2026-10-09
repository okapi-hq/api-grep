import type { Part } from "../../types.js";

const PRINTF_RE = /%(?:\(([^)]+)\))?[-#0 +]*(?:\d+|\*)?(?:\.\d+)?[hlL]?([sdifrxXeEgGcuoa%])/g;
const BRACE_RE = /\{\{|\}\}|\{([^{}!:]*)(?:![rsa])?(?::[^{}]*)?\}/g;

/** Values for a format string: positional parts, and named parts (`%(name)s`, `{name}`). */
export interface FormatArgs {
  positional: Part[][];
  named: Map<string, Part[]>;
}

/** `"%s/users/%d" % (base, id)`, `sprintf('%s/users/%d', $base, $id)`: the template with each conversion replaced. */
export function printfParts(template: string, args: FormatArgs): Part[] {
  const out: Part[] = [];
  let last = 0;
  let i = 0;
  for (const m of template.matchAll(PRINTF_RE)) {
    out.push({ kind: "static", text: template.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[2] === "%") {
      out.push({ kind: "static", text: "%" });
      continue;
    }
    const value = m[1] !== undefined ? args.named.get(m[1]) : args.positional[i++];
    out.push(...(value ?? [{ kind: "dynamic", name: m[1] ?? `arg${i}`, origin: "unknown" }]));
  }
  out.push({ kind: "static", text: template.slice(last) });
  return out.filter((p) => p.kind !== "static" || p.text !== "");
}

/** `"{}/users/{id}".format(base, id=uid)`: `{}` takes the next positional value, `{0}` / `{name}` their own. */
export function braceParts(template: string, args: FormatArgs): Part[] {
  const out: Part[] = [];
  let last = 0;
  let auto = 0;
  for (const m of template.matchAll(BRACE_RE)) {
    out.push({ kind: "static", text: template.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[0] === "{{" || m[0] === "}}") {
      out.push({ kind: "static", text: m[0][0]! });
      continue;
    }
    const field = (m[1] ?? "").split(/[.[]/)[0]!;
    const value = field === "" ? args.positional[auto++] : /^\d+$/.test(field) ? args.positional[Number(field)] : args.named.get(field);
    out.push(...(value ?? [{ kind: "dynamic", name: field || `arg${auto}`, origin: "unknown" }]));
  }
  out.push({ kind: "static", text: template.slice(last) });
  return out.filter((p) => p.kind !== "static" || p.text !== "");
}
