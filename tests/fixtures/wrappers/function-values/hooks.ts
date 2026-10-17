import { useCallback } from "react";

const LEDGER_API = "https://api.ledgerly-demo.io";

// the app's hook hands out a fetch wrapper made by useCallback
export function useLedger() {
  const fetchLedger = useCallback(async (path: string, init: RequestInit = {}) => {
    return fetch(`${LEDGER_API}${path}`, { ...init, headers: { "x-ledger-key": "demo" } });
  }, []);
  return { fetchLedger, ready: true };
}

export function balances() {
  const { fetchLedger } = useLedger();
  return fetchLedger("/v1/balances");
}

export function history() {
  const ledger = useLedger();
  return ledger.fetchLedger("/v1/history", { method: "POST" });
}

export function renamed() {
  const { fetchLedger: load } = useLedger();
  return load("/v1/accounts");
}
