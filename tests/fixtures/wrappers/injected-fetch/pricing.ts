const PRICES_URL = "https://api.example-rates.com/v2/prices";

export class PriceClient {
  constructor(private fetchFn = fetch) {}

  latest() {
    return this.fetchFn(`${PRICES_URL}/latest`);
  }
}

interface Deps {
  fetchUpstream: (url: string) => Promise<Response>;
}

export function relay(deps: Deps, url: string) {
  return deps.fetchUpstream(url);
}
