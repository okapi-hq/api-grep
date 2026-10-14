import { Node, type CallExpression, type Expression, type NewExpression } from "ts-morph";
import { memberChain, unwrap } from "../ast/expr.js";
import { declarationsOf } from "../ast/object.js";
import type { Callee } from "../types.js";

/**
 * TypeChain factories (#85): its ethers targets generate `Token__factory.connect(address, runner)`, which returns `new
 * Contract(address, abi, runner)` typed after the ABI. The factory file is often generated at build time and missing
 * from the repository, so the call stands for that construction by its name alone: an ethers contract on `runner`,
 * with the factory's `abi` when the file is there.
 */

const FACTORY = /^[A-Za-z_$][\w$]*__factory$/;

/** The `abi` a factory class in the scanned code declares (`static readonly abi = _abi`). */
function factoryAbi(factory: Expression): Expression | undefined {
  const decl = declarationsOf(factory)[0];
  const target = decl && (Node.isImportSpecifier(decl) || Node.isImportClause(decl)) ? factory.getSymbol()?.getAliasedSymbol()?.getDeclarations()[0] : decl;
  const prop = target && Node.isClassDeclaration(target) ? target.getStaticProperty("abi") : undefined;
  return prop && Node.isPropertyDeclaration(prop) ? prop.getInitializer() : undefined;
}

/** `Token__factory.connect(address, runner)` as the ethers contract it builds; undefined for any other call. */
export function typechainContract(init: CallExpression | NewExpression, chain: string[]): Callee | undefined {
  if (!Node.isCallExpression(init)) return undefined;
  const callee = unwrap(init.getExpression());
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== "connect") return undefined;
  const owner = memberChain(callee.getExpression());
  const name = owner.chain.at(-1) ?? (Node.isIdentifier(owner.root) ? owner.root.getText() : "");
  if (!FACTORY.test(name)) return undefined;
  const [address, runner] = init.getArguments() as Expression[];
  if (!address) return undefined;
  // no ABI to read: the call itself, which `contract-abi` reads as none
  const abi = (Node.isIdentifier(owner.root) && owner.chain.length === 0 ? factoryAbi(owner.root) : undefined) ?? init;
  // a contract on no runner sends nothing
  const args = runner ? [address, abi, runner] : [address, abi];
  return { package: "ethers", importedName: "Contract", instance: { kind: "new", chain: ["Contract"], args }, chain };
}
