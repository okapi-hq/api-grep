import { Contract, JsonRpcProvider, Wallet } from "ethers";
import tokenAbi from "./token-abi.json";
import { Vault__factory } from "./Vault__factory";
// generated at build time: not in the repository
import { Pool__factory } from "./generated/factories/Pool__factory";

const provider = new JsonRpcProvider("https://rpc.example-chain.net");
const signer = new Wallet(process.env.TREASURY_KEY!, provider);

export async function vaultAssets(address: string) {
  return Vault__factory.connect(address, provider).totalAssets();
}

export async function vaultDeposit(address: string, amount: bigint) {
  const vault = Vault__factory.connect(address, signer);
  return vault.deposit(amount);
}

export async function poolReserves(address: string) {
  return Pool__factory.connect(address, provider).getReserves();
}

export async function tokenBalance(token: string, owner: string) {
  return new Contract(token, tokenAbi, provider).balanceOf(owner);
}

export async function tokenSend(token: string, to: string, amount: bigint) {
  const reader = new Contract(token, tokenAbi, provider);
  return reader.connect(signer).transfer(to, amount);
}

export async function otherBalance(token: string, other: string, owner: string) {
  const first = new Contract(token, tokenAbi, provider);
  return first.attach(other).balanceOf(owner);
}

export async function supplyOf(token: Contract) {
  return token.totalSupply();
}
