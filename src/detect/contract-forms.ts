import type { Callee, RegistryEntry } from "../types.js";
import type { Construction } from "./endpoint.js";
import { receiverTypes } from "./rpc-endpoint.js";

/**
 * Contracts reached in other ways than their construction (#85), read as one: `contract.connect(signer)` and
 * `contract.attach(address)` give the same contract on another runner or at another address; a value declared with a
 * contract type (`token: Contract`) is a contract whose ABI and runner are not known.
 */

export interface ContractView {
  callee: Callee;
  /** Declared with a contract type: the runner is not known. */
  typed?: boolean;
}

/** `reader.connect(signer).transfer(...)`: the contract's construction with the runner (or address) replaced. */
function rebound(callee: Callee, reg: RegistryEntry): Callee | undefined {
  const { instance: inst, rootInstance: root } = callee;
  const rebind = reg.endpoint?.rebind;
  const verb = inst?.chain.at(-1);
  const where = rebind && verb !== undefined && Object.hasOwn(rebind, verb) ? rebind[verb] : undefined;
  const given = inst?.args[0];
  if (!inst || !root || where === undefined || !given || inst.chain.at(-2) !== root.chain.at(-1)) return undefined;
  const args = [...root.args];
  args[Number(where)] = given;
  return { ...callee, instance: { ...root, args } };
}

export function contractView(node: Construction, callee: Callee, reg: RegistryEntry): ContractView {
  const again = rebound(callee, reg);
  if (again) return { callee: again };
  const types = reg.endpoint?.contractTypes;
  if (callee.instance || !callee.viaType || !types || callee.chain.length === 0) return { callee };
  const declared = receiverTypes(node);
  if (!declared.some((t) => types.includes(t))) return { callee };
  return { callee: { ...callee, instance: { kind: "new", chain: [types[0]!], args: [] } }, typed: true };
}
