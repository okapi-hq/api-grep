import { BrowserProvider, type Contract, type Provider } from "ethers";
import { createWalletClient, custom, webSocket, createPublicClient, type PublicClient } from "viem";
import { mainnet } from "viem/chains";
import Web3 from "web3";

// A dApp talks to the user's wallet extension, not to a node over HTTP: none of these is an outbound request.
const injected = (window as any).ethereum;
const browser = new BrowserProvider(injected);
const wallet = createWalletClient({ chain: mainnet, transport: custom(injected) });
const live = createPublicClient({ chain: mainnet, transport: webSocket("wss://eth.example-node.io/ws") });
const web3 = new Web3(Web3.givenProvider);

export async function balances(address: `0x${string}`) {
  await browser.getBalance(address);
  await wallet.sendTransaction({ to: address, value: 1n, account: address, chain: mainnet });
  await live.getBlockNumber();
  return web3.eth.getAccounts();
}

// typed clients: the project builds wallets only, so these are not known to be HTTP either
export async function viaProvider(provider: Provider, address: string) {
  return provider.getBalance(address);
}

export async function viaClient(client: PublicClient) {
  return client.getChainId();
}

// a contract's own method is not the provider's
export async function viaContract(token: Contract, address: string) {
  return token.getBalance(address);
}
