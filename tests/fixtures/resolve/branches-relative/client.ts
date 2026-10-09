// a relative caller argument stays unknown: choosing `base + p` or `p` here would be a guess either way
export function request(base: string, p: string) {
  return fetch(p.startsWith("http") ? p : base + p);
}

export function items(port?: number) {
  return fetch(`https://api.example-host.com${port ? ":" + port : ""}/v1/items`);
}
