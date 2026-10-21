import { readFileSync } from "node:fs";
import path from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { cardFactsInCode, cardFactsOfJson } from "../src/a2a-servers/card-facts.js";
import { firstConstruction } from "../src/a2a-servers/constructions.js";
import type { ResolvedCall } from "../src/assemble.js";
import { a2aOperations, a2aUrl } from "../src/operation/a2a.js";
import { FIXTURES, scanFixture } from "./fixture-helpers.js";

const schema = JSON.parse(readFileSync(path.join(FIXTURES, "..", "..", "schema", "report.v1.json"), "utf8")) as Record<string, unknown>;

/** A resolved A2A call to `url`, performing `name`. */
function resolved(url: string, name: string): ResolvedCall {
  const at = url.indexOf("/", url.indexOf("://") + 3);
  const pathTemplate = at >= 0 ? url.slice(at) : "";
  return {
    location: { file: "a.py", line: 1, col: 1, language: "python" },
    client: "sdk",
    url: { hostKind: "literal", host: "agent.example.test", scheme: "https", pathTemplate, query: [], queryShape: {}, dynamic: [], raw: url },
    method: "POST",
    dynamic: [],
    body: { shape: { type: "object", properties: {}, required: [] }, encoding: "json", dynamic: [], fromLiteral: true },
    headers: { names: [], values: {}, authScheme: "unknown" },
    query: { names: [], shape: {} },
    operation: { protocol: "a2a", name, dynamic: false, from: name === "GetAgentCard" ? "path" : "body" },
  };
}

describe("A2A clients", () => {
  it("names each operation by A2A 1.0, the card's fetch by its path", () => {
    expect(a2aOperations({ method: "POST", path: "", a2a: ["GetAgentCard", "SendMessage"] })).toEqual([
      { protocol: "a2a", name: "GetAgentCard", dynamic: false, from: "path" },
      { protocol: "a2a", name: "SendMessage", dynamic: false, from: "body" },
    ]);
    expect(a2aOperations({ method: "POST", path: "" })).toEqual([]);
  });

  it("fetches the card under the agent's base URL, or at the card URL the code gives", () => {
    const card = a2aUrl(resolved("https://agent.example.test", "GetAgentCard"));
    expect(card.url.raw).toBe("https://agent.example.test/.well-known/agent-card.json");
    expect(card.method).toBe("GET");
    expect(card.body.encoding).toBe("none");
    expect(a2aUrl(resolved("https://agent.example.test/team/", "GetAgentCard")).url.pathTemplate).toBe("/team/.well-known/agent-card.json");
    expect(a2aUrl(resolved("https://agent.example.test/cards/planner.json", "GetAgentCard")).url.raw).toBe("https://agent.example.test/cards/planner.json");
  });

  it("sends the other operations to the agent's base URL, not its card's", () => {
    expect(a2aUrl(resolved("https://agent.example.test/.well-known/agent-card.json", "SendMessage")).url.raw).toBe("https://agent.example.test");
    expect(a2aUrl(resolved("https://agent.example.test/v1/.well-known/agent.json", "GetTask")).url.pathTemplate).toBe("/v1");
    expect(a2aUrl(resolved("https://agent.example.test/a2a", "SendMessage")).url.raw).toBe("https://agent.example.test/a2a");
  });
});

describe("served A2A agents", () => {
  it("lists the constructions and card files a repository serves agents with", async () => {
    const r = await scanFixture("a2a-servers", { exclude: [], examples: 0 });
    const served = r.coverage!.a2aServers!;
    expect(served.count).toBe(5);
    expect(served.servers.map((s) => [s.file, s.line, s.kind, s.construction, s.package])).toEqual([
      ["agents/pantry.py", 5, "sdk", "to_a2a", "google-adk"],
      ["agents/recipes.py", 17, "sdk", "A2AStarletteApplication", "a2a-sdk"],
      ["gateway/main.go", 10, "sdk", "a2asrv.NewHandler", "github.com/a2aproject/a2a-go/v2"],
      ["public/.well-known/agent.json", 1, "card-file", undefined, undefined],
      ["web/server.ts", 12, "sdk", "agentCardHandler", "@a2a-js/sdk"],
    ]);
    expect(served.servers[1]!.card).toEqual({ protocolVersions: ["0.3.0"], bindings: ["JSONRPC"], fields: ["preferredTransport"], cardPaths: [] });
    expect(served.servers[3]!.card).toMatchObject({ protocolVersions: ["0.2.5"], name: "Pantry helper", skills: 2, cardPaths: ["/.well-known/agent.json"] });
    expect(served.servers[4]!.card).toMatchObject({ protocolVersions: ["1.0"], fields: ["supportedInterfaces"] });
    expect(new Ajv({ allErrors: true }).validate(schema, r)).toBe(true);
  });

  it("reads a 1.0 card's interfaces, and leaves what is no card out", () => {
    const card = { name: "Desk", supportedInterfaces: [{ url: "https://x.test", protocolBinding: "GRPC", protocolVersion: "1.0" }], skills: [{}] };
    expect(cardFactsOfJson(card, "/.well-known/agent-card.json")).toEqual({
      protocolVersions: ["1.0"],
      bindings: ["GRPC"],
      fields: ["supportedInterfaces"],
      cardPaths: ["/.well-known/agent-card.json"],
      name: "Desk",
      skills: 1,
    });
    expect(cardFactsOfJson([card], "/x")).toBeUndefined();
    expect(cardFactsOfJson({ skills: [] }, "/x")).toBeUndefined();
  });

  it("reads card facts from code, and skips constructions in comments", () => {
    expect(cardFactsInCode(`supported_interfaces=[AgentInterface(protocol_binding=TransportProtocol.HTTP_JSON, protocol_version="1.0")]`)).toEqual({
      protocolVersions: ["1.0"],
      bindings: ["HTTP+JSON"],
      fields: ["supportedInterfaces"],
      cardPaths: [],
    });
    expect(firstConstruction("# FastA2A(app)\nserver = FastA2A(storage)\n", ["FastA2A"])).toEqual({ name: "FastA2A", line: 2 });
    expect(firstConstruction("x = 'FastA2A is a name'", ["FastA2A"])).toBeUndefined();
  });
});

describe("the table's line for served agents", () => {
  it("names the first agents, and is absent when none is served", async () => {
    const { a2aServersLine } = await import("../src/report/diagnostics.js");
    const r = await scanFixture("a2a-servers", { exclude: [], examples: 0 });
    expect(a2aServersLine(r.coverage!.a2aServers!)).toBe("A2A agents served: 5; agents/pantry.py (to_a2a), agents/recipes.py (A2AStarletteApplication), gateway/main.go (a2asrv.NewHandler), …");
    expect(a2aServersLine({ count: 0, servers: [] })).toBeUndefined();
  });
});
