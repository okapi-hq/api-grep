import { ethers } from "ethers";
import Rewards from "./rewards-artifact.json";

const node = new ethers.JsonRpcProvider(process.env.REWARDS_RPC_URL);
const keeper = new ethers.Wallet(process.env.KEEPER_KEY!, node);

export async function pending(address: string, account: string) {
  const rewards = new ethers.Contract(address, Rewards.abi, node);
  return rewards.pending(account);
}

export async function claimFor(address: string) {
  const { abi } = require("./rewards-artifact.json");
  return new ethers.Contract(address, abi, keeper).claim();
}
