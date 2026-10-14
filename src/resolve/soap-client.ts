import { Node, type Expression } from "ts-morph";
import { unwrap } from "../ast/expr.js";
import { describeCallee, exportedChain } from "../detect/callee.js";
import { soapClientOperation } from "../operation/soap.js";
import type { Operation } from "../report/schema.js";
import type { EvalCtx, Part, RawCall, UrlShape } from "../types.js";
import { evaluate } from "./evaluate.js";
import { soapEndpoint, wsdlOperation } from "./soap-endpoint.js";

/** `path.join(__dirname, "wsdl", "x.wsdl")`, also held in a variable: the pieces joined with `/`. */
function pathJoin(e: Expression, ctx: EvalCtx, depth = 0): Part[] | undefined {
  const u = unwrap(e);
  if (Node.isIdentifier(u) && depth === 0) {
    const decl = u.getSymbol()?.getValueDeclaration();
    const init = decl && Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    return init ? pathJoin(init, ctx, depth + 1) : undefined;
  }
  if (!Node.isCallExpression(u)) return undefined;
  const c = describeCallee(u);
  const [name, ...more] = exportedChain(c);
  if ((c.package !== "path" && c.package !== "node:path") || more.length > 0 || (name !== "join" && name !== "resolve")) return undefined;
  return (u.getArguments() as Expression[]).flatMap((a, i) => [...(i > 0 ? [{ kind: "static", text: "/" } as Part] : []), ...evaluate(a, ctx)]);
}

/**
 * The URL and the operation of a node-soap call (`src/resolve/soap-endpoint.ts`); undefined when the client's WSDL
 * file, read, does not declare the operation: the method is not one.
 */
export function soapClientCall(soap: NonNullable<RawCall["soap"]>, file: string, rootDir: string, ctx: EvalCtx): { url: UrlShape; operation: Operation } | undefined {
  const wsdl = soap.wsdlExpr ? (pathJoin(soap.wsdlExpr, ctx) ?? evaluate(soap.wsdlExpr, ctx)) : undefined;
  const location = soap.locationExpr ? evaluate(soap.locationExpr, ctx) : undefined;
  const target = soapEndpoint({ wsdl, location, file, rootDir }, ctx);
  const name = wsdlOperation(soap.operation, target.wsdl);
  return name === undefined ? undefined : { url: target.url, operation: soapClientOperation(name) };
}
