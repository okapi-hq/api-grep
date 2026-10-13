import { Contract, JsonRpcProvider, Wallet, ethers } from "ethers";

const TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
const VAULT_ABI = [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }];

const provider = new JsonRpcProvider(`https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`);
const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
const token = new Contract("0x00000000000000000000000000000000000000aa", TOKEN_ABI, provider);
const signed = new ethers.Contract("0x00000000000000000000000000000000000000aa", TOKEN_ABI, wallet);

export async function balance(owner: string) {
  return token.balanceOf(owner);
}

export async function pay(to: string, amount: bigint) {
  return signed.transfer(to, amount);
}

export async function payCost(to: string, amount: bigint) {
  return signed.transfer.estimateGas(to, amount);
}

export async function dryRun(to: string, amount: bigint) {
  return signed.transfer.staticCall(to, amount);
}

export async function deposit(abi: string[], amount: bigint) {
  const vault = new Contract("0x00000000000000000000000000000000000000bb", abi, wallet);
  return vault.deposit({ value: amount });
}

export async function depositAsNode(amount: bigint) {
  const vault = new Contract("0x00000000000000000000000000000000000000bb", VAULT_ABI, await provider.getSigner());
  return vault.deposit({ value: amount });
}

export async function transfers(from: number) {
  return token.queryFilter("Transfer", from);
}

export function tokenAddress() {
  // the contract's own members send nothing
  token.interface.getFunction("transfer");
  return token.getAddress();
}
