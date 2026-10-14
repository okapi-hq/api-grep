import { JsonRpcProvider } from "ethers";
import { createContext, use, type ReactNode } from "react";

// React 19: the context is its own provider, read with `use`
const ArchiveContext = createContext<{ archive: JsonRpcProvider } | null>(null);

export function ArchiveRoot({ children }: { children: ReactNode }) {
  return <ArchiveContext value={{ archive: new JsonRpcProvider("https://archive.example-node.io/rpc") }}>{children}</ArchiveContext>;
}

export function useGenesis() {
  return use(ArchiveContext)!.archive.getBlock(0);
}
