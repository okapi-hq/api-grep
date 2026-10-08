async function doFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  return res.json();
}

export function tlsFetch(url: string) {
  return doFetch(url, { headers: { "x-client": "probe" } });
}

export const latest = () => tlsFetch("https://api.example.com/v1/releases/latest");
