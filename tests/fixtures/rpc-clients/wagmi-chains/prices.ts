import { useBlockNumber, useGasPrice } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { appConfig } from "./providers";

export function useNetworkState() {
  const { data: block } = useBlockNumber({ watch: true });
  const { data: gasPrice } = useGasPrice();
  return { block, gasPrice };
}

export async function feeHistory() {
  const client = getPublicClient(appConfig);
  return client.getFeeHistory({ blockCount: 4, rewardPercentiles: [50] });
}
