import { Contract, type Provider } from "ethers";
import { getArchive, getReader, getWallet } from "./providers";

const ERC20_ABI = ["function balanceOf(address owner) view returns (uint256)"];

// the provider factory is injected: what it returns is what the callers pass
export class TokenService {
  constructor(private readonly getProvider: (chainId: number) => Provider) {}

  balance(chainId: number, token: string, owner: string) {
    return new Contract(token, ERC20_ABI, this.getProvider(chainId)).balanceOf(owner);
  }

  head(chainId: number) {
    const provider = this.getProvider(chainId);
    return provider.getBlockNumber();
  }
}

export const tokens = new TokenService(getReader);

// two factories with different nodes: the host depends on which one the service was built with
export class HistoryService {
  private readonly providerFor: (chainId: number) => Provider;

  constructor(providerFor: (chainId: number) => Provider) {
    this.providerFor = providerFor;
  }

  block(chainId: number, tag: string) {
    return this.providerFor(chainId).getBlock(tag);
  }
}

export const recent = new HistoryService(getReader);
export const history = new HistoryService(getArchive);

// a factory handing out the connected wallet's provider: no HTTP request of the app
export class WalletService {
  constructor(private readonly connect: (chainId: number) => Provider) {}

  nonce(chainId: number, address: string) {
    return this.connect(chainId).getTransactionCount(address);
  }
}

export const wallet = new WalletService(getWallet);
