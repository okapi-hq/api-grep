import { describe, expect, it } from "vitest";
import { sdkTarget, type SdkSource } from "../../src/resolve/sdk-template.js";
import { wrapShape } from "../../src/resolve/shape-utils.js";
import type { MethodSpec, Shape } from "../../src/types.js";

/** A source whose arguments are the given values, by `params` source (`arg:0.product_id`). */
function source(spec: MethodSpec, given: Record<string, string>): SdkSource<string> {
  return {
    spec,
    host: "{shop}.myshopify.com",
    inlinePath: true,
    evaluate: (e) => [{ kind: "static", text: e }],
    urlParts: (e) => [{ kind: "static", text: e }],
    param: (s) => (s in given ? { expr: given[s] } : {}),
    arg: () => undefined,
    bodyProp: () => undefined,
  };
}

const metafields: MethodSpec = {
  method: "GET",
  path: "/metafields.json",
  paths: ["/products/{product_id}/metafields.json", "/products/{product_id}/variants/{variant_id}/metafields.json"],
  params: { product_id: "arg:0.product_id", variant_id: "arg:0.variant_id" },
};

describe("paths a library picks by the ids it is given (#92)", () => {
  it("takes the most specific path whose ids are all given", () => {
    expect(sdkTarget(source(metafields, {})).url.pathTemplate).toBe("/metafields.json");
    expect(sdkTarget(source(metafields, { "arg:0.product_id": "7" })).url.pathTemplate).toBe("/products/7/metafields.json");
    expect(sdkTarget(source(metafields, { "arg:0.product_id": "7", "arg:0.variant_id": "9" })).url.pathTemplate).toBe("/products/7/variants/9/metafields.json");
  });

  it("updates a record once its id is set", () => {
    const save: MethodSpec = { method: "POST", path: "/products.json", params: { id: "record:id" }, record: { body: true, withId: { method: "PUT", path: "/products/{id}.json" } } };
    expect(sdkTarget(source(save, {}))).toMatchObject({ method: "POST", url: { pathTemplate: "/products.json" } });
    expect(sdkTarget(source(save, { "record:id": "5" }))).toMatchObject({ method: "PUT", url: { pathTemplate: "/products/5.json" } });
  });
});

describe("route helpers (discord.js `Routes`)", () => {
  const put: MethodSpec = { method: "PUT", path: "/api/v10{route}", params: { route: "arg:0" }, routeHelperArg: 0 };
  const routes = { applicationGuildCommands: "/applications/{application_id}/guilds/{guild_id}/commands" };
  /** `rest.put(<route>)`: a helper call written as `helper(a,b)`, or a route string. */
  const routed = (route: string): SdkSource<string> => ({
    ...source(put, { "arg:0": route }),
    host: "discord.com",
    arg: (i) => (i === 0 ? route : undefined),
    routes,
    routeCall: (e) => {
      const m = /^(\w+)\((.*)\)$/.exec(e);
      return m ? { name: m[1]!, args: m[2]!.split(",") } : undefined;
    },
  });

  it("writes the helper's path, its arguments filling the placeholders in order", () => {
    expect(sdkTarget(routed("applicationGuildCommands(app,guild)"))).toMatchObject({ method: "PUT", url: { pathTemplate: "/api/v10/applications/app/guilds/guild/commands" } });
  });

  it("takes a route written as a string as it is", () => {
    expect(sdkTarget(routed("/users/@me")).url.pathTemplate).toBe("/api/v10/users/@me");
  });
});

describe("wrapShape", () => {
  const message: Shape = { type: "string" };

  it("wraps a body under a key, or under nested keys for a dotted one", () => {
    expect(wrapShape(message, "address")).toEqual({ type: "object", properties: { address: message }, required: ["address"] });
    expect(wrapShape(message, "fulfillment_order.message")).toEqual({
      type: "object",
      properties: { fulfillment_order: { type: "object", properties: { message }, required: ["message"] } },
      required: ["fulfillment_order"],
    });
  });

  it("leaves the body as it is for a key a record cannot hold", () => {
    expect(wrapShape(message, "a.__proto__")).toBe(message);
  });
});
