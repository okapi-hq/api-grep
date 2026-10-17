const cache = new Map<string, string>();

// the callers pass functions that read memory, not the network: no call
async function withRetry(fetchPage: any, url: string) {
  return fetchPage(url);
}

export const cached = () => withRetry((key: string) => cache.get(key), "https://docs.offline-demo.io/v1/page");

export const stubbed = () => withRetry(async (u: string) => new Response(JSON.stringify({ u })), "https://stub.offline-demo.io/v1/ok");

// a hook handing out a function that reads local data only
function useStore() {
  const fetchItem = (id: string) => Promise.resolve(cache.get(id));
  return { fetchItem };
}

export function item() {
  const { fetchItem } = useStore();
  return fetchItem("/items/1");
}
