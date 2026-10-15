// Docs: https://api.github.com/v3/repos is in a comment, not a literal
const DOCS = "https://docs.stripe.com/api/customers";
const SCHEMA = { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://example.com/v1/customer.json" };
const REPO = "https://github.com/acme-labs/ledger";
const SVG = "http://www.w3.org/2000/svg";

export async function createCustomer(email: string, key: string) {
  const res = await fetch("https://api.stripe.com/v1/customers", {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: new URLSearchParams({ email }),
  });
  return { customer: await res.json(), links: [DOCS, REPO, SVG], schema: SCHEMA };
}
