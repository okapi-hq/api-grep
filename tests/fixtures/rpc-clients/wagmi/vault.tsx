import { useEffect, useState } from "react";
import { useBalance, usePublicClient, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { getBlockNumber, readContract, writeContract } from "@wagmi/core";
import { config } from "./config";

const vaultAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }], outputs: [] },
] as const;

export function VaultPanel({ vault, owner }: { vault: `0x${string}`; owner: `0x${string}` }) {
  const shares = useReadContract({ address: vault, abi: vaultAbi, functionName: "balanceOf", args: [owner] });
  const balance = useBalance({ address: owner });
  // signed and sent by the connected wallet: no HTTP request of the app
  const { writeContract: deposit, data: hash } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const client = usePublicClient();
  const [events, setEvents] = useState<unknown[]>([]);
  useEffect(() => {
    client?.getLogs({ address: vault }).then(setEvents);
  }, [client, vault]);
  return { shares, balance, receipt, events, deposit: (amount: bigint) => deposit({ address: vault, abi: vaultAbi, functionName: "deposit", args: [amount] }) };
}

export async function sharesOf(vault: `0x${string}`, owner: `0x${string}`) {
  return readContract(config, { address: vault, abi: vaultAbi, functionName: "balanceOf", args: [owner] });
}

export async function latestBlock() {
  return getBlockNumber(config);
}

export async function depositFor(vault: `0x${string}`, amount: bigint) {
  return writeContract(config, { address: vault, abi: vaultAbi, functionName: "deposit", args: [amount] });
}
