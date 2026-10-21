import { z } from "zod";

/** The A2A agents a repository serves: a diagnostic of `coverage`, no call. */

export const A2aCardFactsSchema = z
  .object({
    protocolVersions: z.array(z.string()).describe("A2A protocol versions the card states (`protocolVersion`, each interface's), literal values only, sorted."),
    bindings: z
      .array(z.string())
      .describe("Protocol bindings the card offers (`JSONRPC`, `GRPC`, `HTTP+JSON`: `preferredTransport`, interfaces' `transport` or `protocolBinding`), sorted."),
    fields: z
      .array(z.string())
      .describe(
        "Version-telling card fields it writes, camel case, sorted: `supportedInterfaces` (1.0), or the fields it replaced (`preferredTransport`, `additionalInterfaces`, `supportsAuthenticatedExtendedCard`).",
      ),
    cardPaths: z.array(z.string()).describe("Well-known card paths the file writes (`/.well-known/agent-card.json`, the older `/.well-known/agent.json`), sorted."),
    name: z.string().optional().describe("The card's `name`, for a card file."),
    skills: z.number().optional().describe("The card's skills, for a card file."),
  })
  .meta({ id: "A2aCardFacts", description: "What a served agent's card says, read as literal text: absent parts were not found." });

export const A2aServerSchema = z
  .object({
    file: z.string().describe("Relative to the scanned directory."),
    line: z.number().describe("1-based line of the construction (the first one in the file), or 1 for a card file."),
    kind: z.enum(["sdk", "card-file"]).describe("sdk: an A2A SDK or framework construction serving an agent; card-file: an agent card committed under `.well-known/`."),
    construction: z.string().optional().describe("sdk: what serves the agent (`A2AStarletteApplication`, `to_a2a`, `A2AExpressApp`, `a2asrv.NewHandler`)."),
    package: z.string().optional().describe("sdk: the package it comes from (`a2a-sdk`, `@a2a-js/sdk`, `google-adk`)."),
    card: A2aCardFactsSchema,
  })
  .meta({ id: "A2aServer", description: "An A2A (Agent2Agent) agent the repository serves." });

export const A2aServersSchema = z
  .object({
    count: z.number().describe("Agents found: files with a serving construction, and card files; `servers` lists at most 200."),
    servers: z.array(A2aServerSchema).describe("By file path; at most 200."),
  })
  .meta({
    id: "A2aServers",
    description:
      "Since 1.30.0: the A2A (Agent2Agent) agents the repository serves, by SDK and framework constructions and committed agent cards, with what their cards say (protocol versions, bindings, fields that tell the version). A measurement only: serving an agent receives requests, so no call is reported for it.",
  });

export type A2aServers = z.infer<typeof A2aServersSchema>;
export type A2aServer = z.infer<typeof A2aServerSchema>;
export type A2aCardFacts = z.infer<typeof A2aCardFactsSchema>;
