import { createPublicClient, createWalletClient, getContract, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import Web3 from "web3";

const abi = parseAbi(["function balanceOf(address owner) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"]);

const web3 = new Web3("https://eth.example-node.io");
const legacy = new web3.eth.Contract(abi as never, "0x00000000000000000000000000000000000000aa");

export async function legacyBalance(owner: string) {
  return legacy.methods.balanceOf(owner).call();
}

export async function legacyPay(to: string, amount: bigint, from: string) {
  return legacy.methods.transfer(to, amount).send({ from });
}

const reader = createPublicClient({ transport: http("https://eth-mainnet.g.alchemy.com/v2/demo") });
const signer = createWalletClient({ account: privateKeyToAccount("0x01"), transport: http("https://rpc.example-chain.net") });
const token = getContract({ address: "0x00000000000000000000000000000000000000aa", abi, client: { public: reader, wallet: signer } });
const readOnly = getContract({ address: "0x00000000000000000000000000000000000000aa", abi, client: reader });

export async function balance(owner: `0x${string}`) {
  return token.read.balanceOf([owner]);
}

export async function pay(to: `0x${string}`, amount: bigint) {
  return token.write.transfer([to, amount]);
}

export async function supplyOnly(owner: `0x${string}`) {
  return readOnly.read.balanceOf([owner]);
}
