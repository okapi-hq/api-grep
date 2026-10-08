import { Node, SyntaxKind, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import type { Callee, MethodSpec, RawCall, RegistryEntry } from "../types.js";
import { exportedChain } from "./callee.js";
import { getProp } from "./options.js";
import type { Registry } from "./registry/index.js";

function candidateKeys(callee: Callee, reg: RegistryEntry): string[] {
  const keys = new Set<string>();
  const own = callee.chain.join(".");
  if (own) keys.add(own);
  if (callee.instance) {
    const ctorNames = new Set(reg.instance?.names ?? ["default"]);
    const instChain = callee.instance.chain.filter((n) => !ctorNames.has(n));
    const flat = [...instChain, ...callee.chain].join(".");
    if (flat) keys.add(flat);
  } else if (!callee.viaType) {
    const exp = exportedChain(callee).join(".");
    if (exp) keys.add(exp);
  }
  for (const k of [...keys]) if (k.startsWith("rest.")) keys.add(k.slice(5));
  return [...keys];
}

/** Base URL passed to the client's constructor (`createClient(url, key)`, `new OpenAI({ baseURL })`), also through builders. */
function clientUrlArg(callee: Callee, reg: RegistryEntry): Expression | undefined {
  const urlArg = reg.instance?.urlArg;
  if (!urlArg) return undefined;
  for (const inst of [callee.rootInstance, callee.instance]) {
    // a default import (`import OpenAI from "openai"; new OpenAI(...)`) has an empty chain
    const ctor = inst ? (inst.chain[inst.chain.length - 1] ?? "default") : undefined;
    const where = ctor !== undefined ? urlArg[ctor] : undefined;
    if (!inst || where === undefined) continue;
    const [idx, prop] = String(where).split(".");
    const arg = inst.args[Number(idx)];
    return prop ? getProp(arg, prop) : arg;
  }
  return undefined;
}

/** MCP-style clients get their server URL from a transport built next to them: the one `new Transport(url)` of the file. */
function fileUrlArg(node: Node, reg: RegistryEntry): Expression | undefined {
  const from = reg.urlFromFile;
  if (!from) return undefined;
  const built = node
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.NewExpression)
    .filter((n) => from.new.includes(n.getExpression().getText()));
  return built.length === 1 ? (built[0]!.getArguments()[from.arg] as Expression | undefined) : undefined;
}

function buildRaw(node: CallExpression | NewExpression, reg: RegistryEntry, key: string, spec: MethodSpec, callee: Callee): RawCall {
  const args = node.getArguments() as Expression[];
  const raw: RawCall = {
    node,
    client: "sdk",
    sdk: {
      // the package actually imported (`@supabase/ssr`, `@sentry/nextjs`), not the registry's main one
      package: callee.package ?? reg.package,
      provider: reg.provider,
      host: spec.host ?? reg.host,
      chain: key,
      spec,
      auth: spec.auth ?? reg.auth,
      args,
      instanceArgs: callee.instance?.args,
      inlinePath: reg.inlinePathLiterals,
      basePath: reg.basePath,
    },
    bodyKey: "input",
  };
  if (spec.bodyArg !== undefined) raw.bodyExpr = spec.bodyProp ? getProp(args[spec.bodyArg], spec.bodyProp) : args[spec.bodyArg];
  if (spec.queryArg !== undefined) raw.queryExpr = args[spec.queryArg];
  if (spec.urlFromInstanceArg !== undefined && callee.instance) raw.urlExpr = callee.instance.args[spec.urlFromInstanceArg];
  const base = clientUrlArg(callee, reg) ?? fileUrlArg(node, reg);
  if (base) raw.baseUrlExpr = base;
  return raw;
}

export function detectSdk(node: CallExpression | NewExpression, callee: Callee, registry: Registry): RawCall | null {
  const reg = registry.byPackage(callee.package);
  if (!reg) return null;
  if (Node.isNewExpression(node)) {
    const name = exportedChain(callee).join(".");
    const spec = reg.commands?.[name];
    return spec ? buildRaw(node, reg, name, spec, callee) : null;
  }
  if (!reg.methods) return null;
  for (const key of candidateKeys(callee, reg)) {
    const spec = reg.methods[key];
    if (spec) return buildRaw(node, reg, key, spec, callee);
  }
  return null;
}
