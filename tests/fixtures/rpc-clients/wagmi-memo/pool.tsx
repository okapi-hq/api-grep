import { useBlockNumber, useReadContract } from "wagmi";

const poolAbi = [{ type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] }] as const;

export function usePool(pool: `0x${string}`) {
  const assets = useReadContract({ address: pool, abi: poolAbi, functionName: "totalAssets" });
  const block = useBlockNumber({ watch: true });
  return { assets, block };
}
