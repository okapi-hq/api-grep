import { BrowserProvider, Contract, JsonRpcProvider, Wallet } from "ethers";
import { createWalletClient, custom, getContract } from "viem";
import Web3 from "web3";

const TOKEN_ABI = ["function balanceOf(address owner) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"];
const ADDRESS = "0x00000000000000000000000000000000000000aa";

// a contract on the wallet's signer, or on the wallet's provider: the wallet talks to its node
export async function walletPay(to: string, amount: bigint) {
  const browser = new BrowserProvider((window as any).ethereum);
  const token = new Contract(ADDRESS, TOKEN_ABI, await browser.getSigner());
  await new Contract(ADDRESS, TOKEN_ABI, browser).balanceOf(to);
  return token.transfer(to, amount);
}

// no runner, or a wallet that is not connected to a provider: nothing can be sent
export async function unconnected(owner: string) {
  await new Contract(ADDRESS, TOKEN_ABI).balanceOf(owner);
  return new Contract(ADDRESS, TOKEN_ABI, new Wallet("0x01")).transfer(owner, 1n);
}

// a provider cannot send a transaction: ethers throws before any request
export async function readOnlyPay(to: string) {
  const node = new JsonRpcProvider("https://eth.example-node.io");
  return new Contract(ADDRESS, TOKEN_ABI, node).transfer(to, 1n);
}

export async function viemWallet(to: `0x${string}`) {
  const wallet = createWalletClient({ transport: custom((window as any).ethereum) });
  const token = getContract({ address: ADDRESS, abi: [], client: wallet });
  return token.write.transfer([to, 1n]);
}

export async function web3Wallet(owner: string) {
  const web3 = new Web3((window as any).ethereum);
  const token = new web3.eth.Contract([], ADDRESS);
  return token.methods.balanceOf(owner).call();
}
