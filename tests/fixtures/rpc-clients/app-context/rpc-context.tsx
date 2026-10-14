import { JsonRpcProvider } from "ethers";
import { createContext, useContext, useMemo, type ReactNode } from "react";

const NODE_URL = "https://ledger.example-node.io/rpc";

interface Rpc {
  provider: JsonRpcProvider;
  chainId: number;
}

export const RpcContext = createContext<Rpc | null>(null);

// the app's own provider component: one client, built once
export function RpcProvider({ children }: { children: ReactNode }) {
  const provider = useMemo(() => new JsonRpcProvider(NODE_URL), []);
  return <RpcContext.Provider value={{ provider, chainId: 1 }}>{children}</RpcContext.Provider>;
}

export function useRpc() {
  const value = useContext(RpcContext);
  if (!value) throw new Error("useRpc outside RpcProvider");
  return value;
}
