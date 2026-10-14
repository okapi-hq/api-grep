import { useContext, useEffect, useState } from "react";
import { RpcContext, useRpc } from "./rpc-context";

export function useHead() {
  const { provider } = useRpc();
  const [head, setHead] = useState(0);
  useEffect(() => {
    provider.getBlockNumber().then(setHead);
  }, [provider]);
  return head;
}

export function useLedgerBalance(owner: string) {
  const rpc = useContext(RpcContext)!;
  return rpc.provider.getBalance(owner);
}
