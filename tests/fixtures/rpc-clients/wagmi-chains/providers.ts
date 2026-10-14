import { createClient, fallback, http } from "viem";
import { createConfig } from "wagmi";
import { base, mainnet } from "wagmi/chains";

const chains = [mainnet, base] as const;

// one client per chain, each with its own RPC endpoints: which one a call uses depends on the chain
export const appConfig = createConfig({
  chains,
  ssr: true,
  client({ chain }) {
    let rpcs = [http()];
    if (chain.id === mainnet.id) rpcs = [http("https://eth.example-node.io/v1"), ...rpcs];
    return createClient({ chain, transport: fallback(rpcs), pollingInterval: 30_000 });
  },
});
