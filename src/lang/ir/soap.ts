import { soapClientOperation } from "../../operation/soap.js";
import type { Operation } from "../../report/schema.js";
import { soapEndpoint, wsdlOf, wsdlOperation } from "../../resolve/soap-endpoint.js";
import type { Part, UrlShape } from "../../types.js";
import { evaluate } from "./evaluate.js";
import type { Scoped } from "./language.js";
import { dottedPath, type Expr, type FunctionDef } from "./model.js";
import type { IrCtx, IrSoap } from "./raw.js";
import { shapeOf } from "./shape.js";
import { deref } from "./values.js";

/** `os.path.join(os.path.dirname(__file__), "wsdl", "x.wsdl")`: the pieces joined with `/`. */
function pathJoin(s: Scoped, ctx: IrCtx): Part[] | undefined {
  const d = deref(s.expr, s.fn, ctx);
  if (d.expr.k !== "call") return undefined;
  const callee = dottedPath(d.expr.fn)?.join(".");
  if (callee !== "os.path.join" && callee !== "path.join") return undefined;
  const pieces = d.expr.args.filter((a) => !a.name && !a.spread);
  return pieces.flatMap((a, i) => [...(i > 0 ? [{ kind: "static", text: "/" } as Part] : []), ...evaluate(a.value, d.fn, ctx)]);
}

function wsdlParts(s: Scoped | undefined, ctx: IrCtx): Part[] | undefined {
  return s ? (pathJoin(s, ctx) ?? evaluate(s.expr, s.fn, ctx)) : undefined;
}

/**
 * The message of an operation called with these arguments: the one argument, or none; several are the parts of an
 * RPC message whose names only the WSDL knows, a body the scan cannot read.
 */
export function soapMessage(args: Expr[], fn: FunctionDef): Scoped | undefined {
  if (args.length === 0) return undefined;
  return { expr: args.length === 1 ? args[0]! : { k: "unknown", text: "arguments" }, fn };
}

/** The URL and the operation of a SOAP client library's call. */
export function irSoapTarget(soap: IrSoap, file: string, ctx: IrCtx, rootDir: string): { url: UrlShape; operation: Operation } {
  const location = soap.location ? evaluate(soap.location.expr, soap.location.fn, ctx) : undefined;
  const { url } = soapEndpoint({ wsdl: wsdlParts(soap.wsdl, ctx), location, file, rootDir }, { envHints: ctx.envHints });
  const op = soap.operation;
  return { url, operation: soapClientOperation(typeof op === "string" ? op : shapeOf(op.expr, op.fn, ctx).shape) };
}

/**
 * The operation a method of the client calls, as its WSDL file spells it; undefined when the WSDL, read, does not
 * declare it (a typo, a method of the code's own).
 */
export function soapOperationName(wsdl: Scoped | undefined, name: string, file: string, ctx: IrCtx): string | undefined {
  if (!ctx.rootDir || !wsdl) return name;
  return wsdlOperation(name, wsdlOf({ wsdl: wsdlParts(wsdl, ctx), file, rootDir: ctx.rootDir }));
}
