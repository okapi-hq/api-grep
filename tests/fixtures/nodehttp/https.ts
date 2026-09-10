import https from "node:https";

export function incident(cb: (res: unknown) => void) {
  const req = https.request({ hostname: "api.pagerduty.com", path: "/incidents", method: "POST", headers: { Authorization: "Token token=abc" } }, cb);
  req.end();
}

export const health = (cb: (res: unknown) => void) => https.get("https://api.example.com/health", cb);
