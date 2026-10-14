import { argOf, arrayOptions } from "../ir/args.js";
import { calleeChain, type Chain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, Expr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw, IrSoap, Seg } from "../ir/raw.js";
import { soapMessage, soapOperationName } from "../ir/soap.js";
import { deref } from "../ir/values.js";

/** `__soapCall($name, $args, $options)` and its deprecated alias `__call`: the operation is an argument. */
const BY_NAME = new Set(["__soapcall", "__call"]);

/** `[$args]`, the arguments `__soapCall` passes, as the operation's message. */
function messageIn(list: Scoped | undefined, ctx: IrCtx): Scoped | undefined {
  if (!list) return undefined;
  const d = deref(list.expr, list.fn, ctx);
  return d.expr.k === "list" ? soapMessage(d.expr.items, d.fn) : list;
}

const positional = (seg: Seg): Expr[] => seg.call?.args.filter((a) => !a.name && !a.spread).map((a) => a.value) ?? [];

const isSoapClient = (seg: Seg | undefined): boolean => seg?.name.toLowerCase() === "soapclient";

/**
 * The construction of the client a call is made on: `new SoapClient(...)`, or for `$this->Track()` in a subclass, its
 * constructor's `parent::__construct($wsdl, $options)`.
 */
function construction(ctor: Seg, call: CallExpr, fn: FunctionDef, ctx: IrCtx): Seg | undefined {
  if (ctor.call) return ctor;
  if (call.fn.k !== "attr" || call.fn.obj.k !== "this") return undefined;
  const init = (ctx.self ?? fn.cls)?.methods.get("__construct");
  for (const c of init?.calls ?? []) {
    // `parent::__construct(...)` reads as the base class's `SoapClient::__construct(...)`
    if (c.fn.k !== "attr" || c.fn.name.toLowerCase() !== "__construct") continue;
    const target = calleeChain(c, init!, ctx);
    if (target.root.kind === "external" && target.segs.length === 2 && isSoapClient(target.segs[0])) return { name: ctor.name, call: c, fn: init };
  }
  return undefined;
}

/**
 * ext-soap's `SoapClient` (#58): `new SoapClient($wsdl, $options)`, then an operation called as a method
 * (`$client->Track($args)`) or by name (`$client->__soapCall('Track', [$args])`). The client's own methods
 * (`__getFunctions()`, `__setSoapHeaders()`) all start with `__`. A `SoapClient` imported from another namespace is
 * not this one: its chain does not start at the global class.
 */
export function detectSoapClient(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  if (chain.root.kind !== "external" || chain.segs.length !== 2) return undefined;
  const [seg, method] = chain.segs as [Seg, Seg];
  if (!isSoapClient(seg) || !(seg.call || seg.typed) || !method.call) return undefined;
  const byName = BY_NAME.has(method.name.toLowerCase());
  if (!byName && method.name.startsWith("__")) return undefined;
  const opArg = byName ? argOf(method, 0, "name") : undefined;
  if (byName && !opArg) return undefined;
  const ctor = construction(seg, call, fn, ctx);
  const wsdlArg = argOf(ctor, 0, "wsdl");
  const wsdl = wsdlArg && deref(wsdlArg.expr, wsdlArg.fn, ctx).expr.k !== "null" ? wsdlArg : undefined;
  const options = arrayOptions(argOf(ctor, 1, "options"), ctx);
  const callOptions = byName ? arrayOptions(argOf(method, 2, "options"), ctx) : undefined;
  const operation = opArg ?? soapOperationName(wsdl, method.name, fn.module.file, ctx);
  if (operation === undefined) return undefined;
  const soap: IrSoap = { wsdl, location: callOptions?.get("location") ?? options.get("location"), operation };
  const body = byName ? messageIn(argOf(method, 1, "args"), ctx) : soapMessage(positional(method), method.fn!);
  return {
    call,
    fn,
    client: "php-soap",
    impliedMethod: "POST",
    body,
    encoding: "xml",
    headers: [],
    auth: options.get("login") ? "basic" : undefined,
    soap,
    inputs: [wsdl, soap.location, opArg, body].filter((v): v is Scoped => !!v),
  };
}
