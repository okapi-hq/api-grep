import { argOf, kwargsDict } from "../ir/args.js";
import type { Chain } from "../ir/chain.js";
import type { Scoped } from "../ir/language.js";
import type { CallExpr, FunctionDef } from "../ir/model.js";
import type { IrCtx, IrRaw, IrSoap, Seg } from "../ir/raw.js";
import { soapMessage, soapOperationName } from "../ir/soap.js";

const CLIENTS = new Set(["Client", "AsyncClient", "CachingClient"]);
/** `zeep.Client`, `zeep.client.Client`. */
const MODULES = [["zeep"], ["zeep", "client"]];

/** The client constructor's index in the chain: right after a zeep module. */
function clientIndex(segs: Seg[]): number {
  for (const mod of MODULES) {
    const i = mod.length;
    if (mod.every((m, j) => segs[j]?.name === m && !segs[j].call) && CLIENTS.has(segs[i]?.name ?? "") && (segs[i]!.call || segs[i]!.typed)) return i;
  }
  return -1;
}

/**
 * The message: keyword arguments (`Track(Id=x)`) as one dict, else the positional ones (`soapMessage`). zeep's own
 * keyword arguments start with `_` (`_soapheaders`).
 */
function messageOf(method: Seg): Scoped | undefined {
  const call = method.call!;
  const skip = new Set(call.args.filter((a) => a.name?.startsWith("_")).map((a) => a.name!));
  const kwargs = kwargsDict(call, skip);
  const positional = call.args.filter((a) => !a.name && !a.spread).map((a) => a.value);
  return kwargs ? { expr: kwargs, fn: method.fn! } : soapMessage(positional, method.fn!);
}

/**
 * zeep (#58): `Client(wsdl).service.Track(...)`, a service bound to another port (`client.bind(service, port).Track`)
 * or to an address the code gives (`client.create_service(binding, address).Track`). Only a chain that starts at
 * zeep's client: a project class with a `service` attribute is not one.
 */
export function detectZeep(call: CallExpr, fn: FunctionDef, ctx: IrCtx, chain: Chain): IrRaw | undefined {
  if (chain.root.kind !== "external") return undefined;
  const i = clientIndex(chain.segs);
  if (i < 0 || chain.segs.length !== i + 3) return undefined;
  const [ctor, via, method] = chain.segs.slice(i) as [Seg, Seg, Seg];
  if (!method.call || method.name.startsWith("_")) return undefined;
  const viaService = via.name === "service" && !via.call;
  const bound = !!via.call && (via.name === "bind" || via.name === "create_service");
  if (!viaService && !bound) return undefined;
  const wsdl = argOf(ctor, 0, "wsdl");
  const operation = soapOperationName(wsdl, method.name, fn.module.file, ctx);
  if (operation === undefined) return undefined;
  const soap: IrSoap = { wsdl, location: via.name === "create_service" ? argOf(via, 1, "address") : undefined, operation };
  const body = messageOf(method);
  return {
    call,
    fn,
    client: "zeep",
    impliedMethod: "POST",
    body,
    encoding: "xml",
    headers: [],
    soap,
    inputs: [soap.wsdl, soap.location, body].filter((v): v is Scoped => !!v),
  };
}
