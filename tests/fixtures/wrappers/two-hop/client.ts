async function doFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function tlsFetch(url: string, init?: RequestInit) {
  return doFetch(url, { ...init, headers: { "x-tls-pin": "on" } });
}

export const listInvoices = () => tlsFetch("https://api.example-billing.com/v1/invoices");

export const payInvoice = (id: string) => tlsFetch(`https://api.example-billing.com/v1/invoices/${id}/pay`, { method: "POST" });
