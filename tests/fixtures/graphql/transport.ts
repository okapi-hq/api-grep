const ENDPOINT = "https://api.example-store.com/graphql";

export const cart = (id: string) =>
  fetch(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({ operationName: "GetCart", variables: { id }, extensions: { persistedQuery: { version: 1, sha256Hash: "4a7d1ed414474e4033ac29ccb8653d9b" } } }),
  });

export const anonymousPersisted = () =>
  fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: "9f86d081884c7d659a2feaa0c55ad015" } } }) });

export const viaGet = () => fetch(`${ENDPOINT}?query=${encodeURIComponent("query StoreHours { hours { open close } }")}`);

export const batch = () =>
  fetch(ENDPOINT, {
    method: "POST",
    body: JSON.stringify([{ query: "query Banner { banner { text } }" }, { query: "query Footer { footer { links { href } } }" }]),
  });

export const raw = () => fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/graphql" }, body: "query Ping { ping }" });

export function anyDocument(query: string, variables: object) {
  return fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ query, variables }) });
}

export const search = (text: string) => fetch("https://api.example-store.com/search", { method: "POST", body: JSON.stringify({ query: text }) });

export const keywords = () => fetch("https://api.example-store.com/search", { method: "POST", body: JSON.stringify({ query: "red shoes" }) });
