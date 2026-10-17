// the fetch a caller passes down, with the caller's default
async function safeFetch(fetchImpl: any, url: string, init?: RequestInit) {
  return fetchImpl(url, init);
}

export async function probeHealth({ base = "https://status.uptimer-demo.io", fetchImpl = fetch } = {}) {
  return safeFetch(fetchImpl, `${base}/v1/health`);
}

// a function given in an options object, destructured by the callee
function restFetch(path: string) {
  return fetch(`https://rows.tabular-demo.io${path}`, { headers: { apikey: "demo" } });
}

async function loadRows({ dbFetch, table }: { dbFetch: any; table: string }) {
  return dbFetch(`/rest/v1/${table}?select=*`);
}

export const orders = () => loadRows({ dbFetch: restFetch, table: "orders" });

// a field the constructor sets from its options
class Poller {
  private readonly fetchFn: any;

  constructor(opts: { fetchFn: any }) {
    this.fetchFn = opts.fetchFn;
  }

  poll(url: string) {
    return this.fetchFn(url);
  }
}

const poller = new Poller({ fetchFn: globalThis.fetch });

export const tick = () => poller.poll("https://jobs.pollster-demo.io/v1/queue");

// the callee's own fallback, for a caller that passes no fetcher
function defaultModelsFetcher(url: string) {
  return fetch(url, { headers: { accept: "application/json" } });
}

async function listModels(args: { baseUrl: string; fetcher?: (url: string) => Promise<Response> }) {
  const fetcher = args.fetcher ?? defaultModelsFetcher;
  return fetcher(`${args.baseUrl}/v1/models`);
}

export const models = () => listModels({ baseUrl: "https://models.catalogue-demo.io" });
