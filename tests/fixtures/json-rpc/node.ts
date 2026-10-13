const NODE_URL = "https://rpc.example-chain.net";

export async function transaction(signature: string) {
  return fetch(NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "jsonParsed" }] }),
  });
}

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(NODE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

export const balance = (address: string) => rpc("getBalance", [address]);
export const slot = () => rpc("getSlot", []);
export const block = (height: number) => rpc("getBlock", [height]);

export async function balanceAndSlot(address: string) {
  return fetch(NODE_URL, {
    method: "POST",
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "getBalance", params: [address] },
      { jsonrpc: "2.0", id: 2, method: "getSlot", params: [] },
      { jsonrpc: "2.0", id: 3, method: "getBalance", params: [address, { commitment: "finalized" }] },
    ]),
  });
}

export async function status(full: boolean, signature: string) {
  return fetch(NODE_URL, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: full ? "getTransaction" : "getSignatureStatuses", params: [signature] }),
  });
}

export async function account(kind: string, address: string) {
  return fetch(NODE_URL, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: `get${kind}Info`, params: [address] }) });
}

export async function legacyCount() {
  return fetch("http://localhost:8332/", { method: "POST", body: JSON.stringify({ method: "getblockcount", params: [], id: "count" }) });
}

// not JSON-RPC: a `method` with no envelope, and a request description for a proxy
export async function pay(amount: number) {
  return fetch("https://api.example-pay.com/v1/payments", { method: "POST", body: JSON.stringify({ method: "card", amount }) });
}

export async function relay(target: string) {
  return fetch("https://relay.example-proxy.com/forward", { method: "POST", body: JSON.stringify({ method: "GET", params: { url: target }, id: 7 }) });
}
