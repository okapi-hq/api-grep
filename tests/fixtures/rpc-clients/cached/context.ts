import { JsonRpcProvider } from "ethers";

// the clients a job runs with, handed around in one object
const services = { rpc: new JsonRpcProvider("https://jobs.example-node.io/rpc"), retries: 3 };

export async function gasPrice() {
  return services.rpc.getGasPrice();
}

export async function blockOf(hash: string) {
  return services.rpc.getBlock(hash);
}
