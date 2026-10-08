// Instrumentation that wraps the global fetch: the forwarding call is not a request of its own.
const origFetch = window.fetch;

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const started = performance.now();
  const res = await origFetch(input, init);
  console.debug("fetch", String(input), performance.now() - started);
  return res;
};

const nativeFetch = globalThis.fetch;
globalThis.fetch = function patched(...args: Parameters<typeof fetch>) {
  return nativeFetch(...args);
};
