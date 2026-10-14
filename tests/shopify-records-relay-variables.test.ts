import { describe, expect, it } from "vitest";
import { at, scanFixture } from "./fixture-helpers.js";

describe("Shopify records read with find (#102)", () => {
  it("`find` then `save()` PUTs what the code sets to the id `find` was given; methods act on that record", async () => {
    const r = await scanFixture("sdk/shopify-found-records", { examples: 0 });
    expect(at(r, "kites.ts", 11)).toMatchObject({
      sdk: { chain: "rest.Product#save" },
      method: "PUT",
      pathTemplate: "/admin/api/{version}/products/{id}.json",
      body: { properties: { product: { properties: { title: { type: "string" }, tags: { enum: ["kites, summer"] } }, required: ["title", "tags"] } } },
    });
    expect(at(r, "kites.ts", 17)).toMatchObject({ method: "DELETE", pathTemplate: "/admin/api/{version}/products/{id}.json" });
    expect(at(r, "kites.ts", 28)).toMatchObject({ method: "POST", pathTemplate: "/admin/api/{version}/orders/{id}/close.json" });
    expect(at(r, "app.kites.edit.tsx", 8)).toMatchObject({ method: "PUT", pathTemplate: "/admin/api/{version}/redirects/{id}.json", body: { properties: { redirect: { required: ["target"] } } } });
    // the app's own `Product.find(...)` then `save()` is a database write
    expect(r.calls.filter((c) => c.location.file === "local-models.ts")).toEqual([]);
  });
});

describe("ShopifyAPI record attributes and prefixed resources (#102)", () => {
  it("attributes set one by one go into the body; `id` makes a PUT; owner ids of the path stay out", async () => {
    const r = await scanFixture("python/shopify-record-attributes", { examples: 0 });
    expect(at(r, "kites.py", 10)).toMatchObject({ method: "POST", body: { properties: { product: { required: ["title", "vendor"] } } } });
    expect(at(r, "kites.py", 17)).toMatchObject({ body: { properties: { product: { required: ["title", "tags"] } } } });
    expect(at(r, "kites.py", 25)).toMatchObject({ method: "PUT", pathTemplate: "/admin/api/{version}/products/{id}.json" });
    // a key set in a branch is optional
    expect(at(r, "kites.py", 33)).toMatchObject({ method: "PUT", body: { properties: { product: { properties: { template_suffix: { enum: ["featured"] } }, required: ["tags"] } } } });
    expect(r.calls.some((c) => c.location.line === 41)).toBe(false);
    expect(at(r, "regions.py", 11)).toMatchObject({ method: "PUT", pathTemplate: "/admin/api/{version}/admin/countries/{country_id}/provinces/{id}.json" });
    const adjustment = at(r, "regions.py", 18);
    expect(adjustment).toMatchObject({ method: "POST", pathTemplate: "/admin/api/{version}/admin/gift_cards/{gift_card_id}/adjustments.json" });
    expect(adjustment.body).toMatchObject({ properties: { adjustment: { required: ["amount", "note"] } } });
  });
});

describe("shopify-api-node `article.tags(blogId?, params)` (#102)", () => {
  it("the blog's tags when an id is given, every article's when the options come first or the id is null", async () => {
    const r = await scanFixture("sdk/shopify-node-tags", { examples: 0 });
    expect(at(r, "tags.ts", 11)).toMatchObject({ pathTemplate: "/admin/blogs/{blog_id}/articles/tags.json", query: ["limit"] });
    expect(at(r, "tags.ts", 15)).toMatchObject({ pathTemplate: "/admin/articles/tags.json", query: ["popular"] });
    expect(at(r, "tags.ts", 19)).toMatchObject({ pathTemplate: "/admin/articles/tags.json" });
    expect(at(r, "tags.ts", 23)).toMatchObject({ pathTemplate: "/admin/blogs/{blog_id}/articles/tags.json" });
    expect(at(r, "tags.ts", 27)).toMatchObject({ pathTemplate: "/admin/articles/tags.json", query: ["limit"] });
  });
});

describe("Relay `useQueryLoader` variables (#102)", () => {
  it("the variables the returned function is given, each call's as an alternative", async () => {
    const r = await scanFixture("graphql-clients/relay-loader-variables", { examples: 0 });
    expect(at(r, "Garden.tsx", 23)).toMatchObject({ body: { properties: { id: { type: "string" }, season: { enum: ["spring"] } } } });
    expect(at(r, "Garden.tsx", 31).body).toMatchObject({ type: "union", anyOf: [{ properties: { first: { enum: [5] } } }, { properties: { first: { enum: [50] } } }] });
    // handed on: the variables are given elsewhere
    expect(at(r, "Garden.tsx", 36).body).toBeUndefined();
  });
});

describe("Hydrogen after 2025.1 (#102)", () => {
  it("the cart handler's delivery address and gift card methods", async () => {
    const r = await scanFixture("graphql-clients/hydrogen-cart-2026", { examples: 0 });
    expect(at(r, "delivery.tsx", 13)).toMatchObject({ operation: { name: "cartDeliveryAddressesRemove", type: "mutation" }, body: { required: ["addressIds"] } });
  });

  it("2026.10: the storefront client's `graphql`, the cart handlers' `get` and `getCart`", async () => {
    const r = await scanFixture("graphql-clients/hydrogen-2026-10", { examples: 0 });
    expect(at(r, "routes.tsx", 13)).toMatchObject({ host: "{shop}.myshopify.com", pathTemplate: "/api/{version}/graphql.json", operation: { name: "TeaProduct" }, body: { required: ["handle"] } });
    expect(at(r, "routes.tsx", 14)).toMatchObject({ sdk: { chain: "createCartServerHandlers#get" }, operation: { name: "Cart", type: "query" } });
    expect(at(r, "routes.tsx", 20)).toMatchObject({ operation: { name: "Cart" }, body: { required: ["id"] } });
    expect(at(r, "storefront.ts", 18)).toMatchObject({ operation: { name: "TeaShop" } });
    expect(r.calls.some((c) => c.location.line === 25)).toBe(false);
  });
});
