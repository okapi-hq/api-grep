import Web3 from "web3";

const web3 = new Web3("https://eth.example-node.io");
const injected = new Web3((window as any).ethereum);

export async function balance(address: string) {
  return web3.eth.getBalance(address);
}

export async function nonce(address: string) {
  return web3.eth.getTransactionCount(address, "pending");
}

export async function broadcast(signed: string) {
  return web3.eth.sendSignedTransaction(signed);
}

export async function walletAccounts() {
  return injected.eth.getAccounts();
}
