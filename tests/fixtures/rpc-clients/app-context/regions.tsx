import { BrowserProvider, JsonRpcProvider } from "ethers";
import { createContext, useContext, type ReactNode } from "react";

// one region per deployment: which node a read goes to depends on where the app is rendered
const RegionContext = createContext<{ reader: JsonRpcProvider } | null>(null);

export function EuropeRegion({ children }: { children: ReactNode }) {
  return <RegionContext.Provider value={{ reader: new JsonRpcProvider("https://eu.example-node.io/rpc") }}>{children}</RegionContext.Provider>;
}

export function AmericasRegion({ children }: { children: ReactNode }) {
  return <RegionContext.Provider value={{ reader: new JsonRpcProvider("https://us.example-node.io/rpc") }}>{children}</RegionContext.Provider>;
}

export function useGasPrice() {
  const { reader } = useContext(RegionContext)!;
  return reader.send("eth_gasPrice", []);
}

// the connected wallet's provider: its requests go through the extension, not an HTTP request of the app
const WalletContext = createContext<BrowserProvider | null>(null);

export function WalletRoot({ children }: { children: ReactNode }) {
  return <WalletContext.Provider value={new BrowserProvider((window as any).ethereum)}>{children}</WalletContext.Provider>;
}

export function useWalletNonce(address: string) {
  const wallet = useContext(WalletContext)!;
  return wallet.getTransactionCount(address);
}
