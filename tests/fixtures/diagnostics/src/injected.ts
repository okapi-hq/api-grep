interface Deps {
  fetchUpstream: (url: string, init?: RequestInit) => Promise<Response>;
}

export class Probe {
  constructor(private readonly fetchFn = fetch) {}

  check(url: string) {
    // the default is the global fetch: reported as a call
    return this.fetchFn(`${url}/health`);
  }
}

export function relay(deps: Deps, url: string) {
  // a fetch function received from the caller: listed as not followed
  return deps.fetchUpstream(url, { method: "POST" });
}

export async function download(fetchImpl: typeof fetch, id: string) {
  return fetchImpl(`https://files.example.com/v1/files/${id}`);
}

export const store = { fetchUsers: () => Promise.resolve([]) };

export function refresh() {
  // fetch-named, but no URL and no Response: not a fetcher
  return store.fetchUsers();
}
