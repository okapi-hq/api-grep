import { BrowserProvider, Contract } from "ethers";
import { Staking__factory } from "./generated/factories/Staking__factory";

// the contracts of this app are signed by the browser wallet: none of their calls is an HTTP request of the app
const wallet = new BrowserProvider((window as any).ethereum);

export async function stake(address: string, amount: bigint) {
  const staking = Staking__factory.connect(address, await wallet.getSigner());
  return staking.stake(amount);
}

export async function rewards(address: string, owner: string) {
  return Staking__factory.connect(address, wallet).earned(owner);
}

export async function claim(staking: Contract) {
  return staking.claim();
}

export async function exit(staking: Contract) {
  return staking.connect(await wallet.getSigner()).exit();
}

export async function unbound(address: string) {
  // a contract on no runner cannot send
  return Staking__factory.connect(address).totalStaked();
}
