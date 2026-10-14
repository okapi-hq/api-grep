import { useBalance } from "wagmi";
import { useReader } from "./web3-provider";

const oracleAbi = [{ type: "function", name: "latestAnswer", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "int256" }] }] as const;

export function useRate(oracle: `0x${string}`) {
  const { readerClient } = useReader();
  return (readerClient as any).readContract({ address: oracle, abi: oracleAbi, functionName: "latestAnswer" });
}

// through the app's config, picked at build time
export function useWalletBalance(address: `0x${string}`) {
  return useBalance({ address });
}
