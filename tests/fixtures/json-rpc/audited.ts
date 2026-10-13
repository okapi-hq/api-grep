const NODE_URL = "https://rpc.example-chain.net";
const AUDIT_URL = "https://audit.example-log.com/v1/events";

// one helper sends an ordinary request on each side of a JSON-RPC request: from a caller, the ordinary ones keep the
// ids they had before the method was reported
async function audited(method: string, tag: string) {
  await fetch(AUDIT_URL, { method: "POST", body: JSON.stringify({ event: tag, step: "before" }) });
  await fetch(NODE_URL, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }) });
  await fetch(AUDIT_URL, { method: "POST", body: JSON.stringify({ event: tag, step: "after" }) });
}

export const health = () => audited("getHealth", "health");
