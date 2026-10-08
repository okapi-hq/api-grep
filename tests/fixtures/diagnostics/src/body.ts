export function configure(monitorId: string) {
  return fetch(`https://api.example.com/v1/monitors/${monitorId}`, {
    method: "PUT",
    body: JSON.stringify({ config: { targetTimeoutMs: { type: 5 }, timeoutMs: 30_000 } }),
  });
}
