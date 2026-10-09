type Upstream = { base: string; path: string; method?: string; headers?: Record<string, string> };

async function callUpstream(call: Upstream) {
  const url = new URL(call.base + call.path);
  const res = await fetch(url, { method: call.method ?? "GET", headers: call.headers });
  return res.json();
}

function proxyUpstream(requestId: string, call: Upstream) {
  return callUpstream({ ...call, headers: { "x-request-id": requestId, ...(call.headers ?? {}) } });
}

const WEATHER = "https://api.example-weather.com";

export const forecast = (id: string) => proxyUpstream(id, { base: WEATHER, path: "/v1/forecast" });

export const savePlan = (id: string) => proxyUpstream(id, { base: WEATHER, path: "/v1/plans", method: "POST" });

export const report = (id: string) =>
  fetch("https://api.example-weather.com" + "/v1/stations/" + id + "/reports/" + new Date().getFullYear() + "/summary?units=" + "metric");

export const history = (station?: string) => proxyUpstream("h", { base: WEATHER, path: `/v1/stations/${station ?? ""}/history` });
