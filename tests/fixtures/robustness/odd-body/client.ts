// Body values that used to produce shapes the report schema rejected: a property named `type` holding a number,
// and numeric separators (`30_000` used to become NaN).
export async function configure(monitorId: string) {
  return fetch(`https://api.example.com/v1/monitors/${monitorId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { targetTimeoutMs: { type: 5 }, timeoutMs: 30_000, retries: 0x3 } }),
  });
}
