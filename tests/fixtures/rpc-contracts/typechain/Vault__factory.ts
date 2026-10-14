// shaped like a TypeChain (ethers-v6 target) factory
import { Contract, Interface, type ContractRunner } from "ethers";
import type { Vault } from "./Vault";

const _abi = [
  { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }], outputs: [] },
] as const;

export class Vault__factory {
  static readonly abi = _abi;
  static createInterface(): Interface {
    return new Interface(_abi);
  }
  static connect(address: string, runner?: ContractRunner | null): Vault {
    return new Contract(address, _abi, runner) as unknown as Vault;
  }
}
