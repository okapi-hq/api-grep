import { describe, expect, it } from "vitest";
import { matchOperation } from "../../src/validate/match.js";
import type { LoadedSpec, SpecOperation } from "../../src/validate/spec-loader.js";

function op(method: string, pathKey: string): SpecOperation {
  return { method, pathKey, operationId: `${method} ${pathKey}`, ref: pathKey };
}

const spec: LoadedSpec = {
  provider: "x",
  source: "x.yaml",
  basePaths: ["", "/v1"],
  paths: new Map<string, Record<string, SpecOperation>>([
    ["/customers", { GET: op("GET", "/customers"), POST: op("POST", "/customers") }],
    ["/customers/{id}", { GET: op("GET", "/customers/{id}") }],
    ["/customers/search", { GET: op("GET", "/customers/search") }],
  ]),
};

describe("matchOperation", () => {
  it("prefers static matches over placeholders", () => {
    expect(matchOperation(spec, "GET", "/v1/customers/search")?.pathKey).toBe("/customers/search");
    expect(matchOperation(spec, "GET", "/v1/customers/{customer}")?.pathKey).toBe("/customers/{id}");
  });

  it("lets id-looking literals match placeholders and respects the method", () => {
    expect(matchOperation(spec, "GET", "/v1/customers/cus_ABC12345678")?.pathKey).toBe("/customers/{id}");
    expect(matchOperation(spec, "DELETE", "/v1/customers/cus_ABC12345678")).toBeUndefined();
    expect(matchOperation(spec, "POST", "/customers")?.pathKey).toBe("/customers");
  });
});
