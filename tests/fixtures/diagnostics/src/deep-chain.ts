async function doFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  return res.json();
}

function retrying(url: string) {
  return doFetch(url, { headers: { "x-retry": "1" } });
}

function signed(url: string) {
  return retrying(url);
}

function tlsFetch(url: string) {
  return signed(url);
}

// five wrappers from fetch: beyond what wrappers expand, so listed as not followed
export function probe(url: string) {
  return tlsFetch(url);
}

export const latest = () => probe("https://api.example.com/v1/releases/latest");
