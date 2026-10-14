import { JsonRpcProvider } from "ethers";

const provider = new JsonRpcProvider("https://jobs.example-node.io/rpc");

// the job's context, handed to each step as an untyped parameter
async function settle(ctx, address) {
  const balance = await ctx.provider.getBalance(address);
  return { address, balance };
}

async function report(ctx) {
  return ctx.rpc.getBlockNumber();
}

export async function runSettlement(address) {
  return settle({ provider, retries: 3 }, address);
}

// an object of the app's that holds no client: nothing to follow
export async function runReport(store) {
  return report({ rpc: store });
}
