const SERVER = "https://mcp.linear.app/mcp";

export async function searchWeb(query: string) {
  return fetch("https://mcp.harborlight-search.dev/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "web_search", arguments: { query } } }),
  });
}

async function rpc(method: string, params: Record<string, unknown>) {
  const res = await fetch(SERVER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
  });
  return res.json();
}

export const readIssue = (id: string) => rpc("resources/read", { uri: `issue://${id}` });
export const listTools = () => rpc("tools/list", {});

export async function callTool(tool: string) {
  return fetch(SERVER, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: tool, arguments: {} } }),
  });
}

export async function weather(city: string) {
  return fetch("https://mcp.harborlight-search.dev/mcp", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "forecast_summary", arguments: { city } } }),
  });
}

// `getTransaction` is no MCP method: its `params.name` names nothing on a server
export async function notMcp() {
  return fetch("https://rpc.example-chain.net", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "getTransaction", params: { name: "x" } }),
  });
}
