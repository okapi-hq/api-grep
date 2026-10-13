import { AlchemyProvider, Contract, InfuraProvider, QuickNodeProvider, ethers } from "ethers";

const NETWORK = "sepolia";
const infura = new InfuraProvider(NETWORK, process.env.INFURA_PROJECT_ID);
const alchemy = new AlchemyProvider(undefined, process.env.ALCHEMY_KEY);
const quicknode = new QuickNodeProvider("base", process.env.QUICKNODE_TOKEN);
const legacy = new ethers.providers.InfuraProvider("homestead", { projectId: "demo" });
const fallback = ethers.getDefaultProvider("mainnet");
const direct = ethers.getDefaultProvider("https://eth.example-node.io/rpc");

export async function heads(chain: string) {
  await infura.getBlockNumber();
  await alchemy.getBalance("0x00000000000000000000000000000000000000aa");
  await quicknode.getGasPrice();
  await legacy.getTransactionCount("0x00000000000000000000000000000000000000aa");
  await fallback.getBlockNumber();
  await direct.getBlockNumber();
  return new AlchemyProvider(chain).getBlockNumber();
}

export async function feed() {
  const oracle = new Contract("0x00000000000000000000000000000000000000cc", ["function latestAnswer() view returns (int256)"], alchemy);
  return oracle.latestAnswer();
}

export async function socket() {
  return InfuraProvider.getWebSocketProvider("mainnet").getBlockNumber();
}
