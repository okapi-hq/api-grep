import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
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

/** Base URL passed to the client's constructor (`createClient(url, key)`), also when the call hangs off a builder of it. */
function clientUrlArg(callee: Callee, reg: RegistryEntry): Expression | undefined {
  const urlArg = reg.instance?.urlArg;
  if (!urlArg) return undefined;
  for (const inst of [callee.rootInstance, callee.instance]) {
    const ctor = inst?.chain[inst.chain.length - 1];
    const idx = ctor !== undefined ? urlArg[ctor] : undefined;
    if (inst && idx !== undefined) return inst.args[idx];
  }
  return undefined;
}

function buildRaw(node: CallExpression | NewExpression, reg: RegistryEntry, key: string, spec: MethodSpec, callee: Callee): RawCall {
  const args = node.getArguments() as Expression[];
  const raw: RawCall = {
    node,
    client: "sdk",
    sdk: {
      package: reg.package,
      provider: reg.provider,
      host: spec.host ?? reg.host,
      chain: key,
      spec,
      auth: spec.auth ?? reg.auth,
      args,
      instanceArgs: callee.instance?.args,
      inlinePath: reg.inlinePathLiterals,
    },
    bodyKey: "input",
  };
  if (spec.bodyArg !== undefined) raw.bodyExpr = spec.bodyProp ? getProp(args[spec.bodyArg], spec.bodyProp) : args[spec.bodyArg];
  if (spec.queryArg !== undefined) raw.queryExpr = args[spec.queryArg];
  if (spec.urlFromInstanceArg !== undefined && callee.instance) raw.urlExpr = callee.instance.args[spec.urlFromInstanceArg];
  const base = clientUrlArg(callee, reg);
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
