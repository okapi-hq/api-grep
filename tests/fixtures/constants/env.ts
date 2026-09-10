const host = process.env.ANALYTICS_HOST;

export function track(event: string) {
  return fetch(`${host}/v1/track`, { method: "POST", body: JSON.stringify({ event, ts: Date.now() }) });
}

export function unknownHost() {
  return fetch(`${process.env.OTHER_HOST}/things`);
}
