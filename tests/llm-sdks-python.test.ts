import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

const keys = (c: Call): string[] => Object.keys((c.body as { properties?: object } | undefined)?.properties ?? {}).sort();

describe("Z.ai Python SDKs", () => {
  const zai = scanFixture("python/sdk/zai");

  it("zhipuai: ZhipuAI on open.bigmodel.cn under /api/paas/v4, keyword (and some positional) arguments as the body", async () => {
    const r = await zai;
    expect(at(r, "tutor.py", 9)).toMatchObject({ provider: "zai", method: "POST", host: "open.bigmodel.cn", pathTemplate: "/api/paas/v4/chat/completions", authScheme: "bearer", model: { values: ["glm-4-plus"] } });
    expect(keys(at(r, "tutor.py", 9))).toEqual(["messages", "model", "temperature"]);
    expect(at(r, "tutor.py", 13)).toMatchObject({ pathTemplate: "/api/paas/v4/async/chat/completions", model: { values: ["glm-4-air"] } });
    expect(at(r, "tutor.py", 17)).toMatchObject({ method: "GET", pathTemplate: "/api/paas/v4/async-result/{id}" });
    expect(at(r, "tutor.py", 21)).toMatchObject({ pathTemplate: "/api/paas/v4/embeddings", model: { values: ["embedding-3"] } });
    expect(at(r, "tutor.py", 25)).toMatchObject({ pathTemplate: "/api/paas/v4/images/generations", model: { values: ["cogview-4"] } });
    // `videos.generations(model, ...)` takes the model by position
    expect(at(r, "tutor.py", 29)).toMatchObject({ pathTemplate: "/api/paas/v4/videos/generations", model: { values: ["cogvideox-2"] } });
    expect(at(r, "tutor.py", 33)).toMatchObject({ pathTemplate: "/api/paas/v4/files", bodyEncoding: "multipart" });
    expect(at(r, "tutor.py", 37)).toMatchObject({ method: "DELETE", pathTemplate: "/api/paas/v4/files/{file_id}" });
    // the SDK joins `/v1/agents` under its base URL
    expect(at(r, "tutor.py", 41)).toMatchObject({ pathTemplate: "/api/paas/v4/v1/agents" });
    expect(keys(at(r, "tutor.py", 41))).toEqual(["agent_id", "messages"]);
    // a base URL the code gives replaces the default one, `/api/paas/v4` included
    expect(at(r, "tutor.py", 48)).toMatchObject({ host: "llm-gw.tidewater.dev", pathTemplate: "/zhipu/api/paas/v4/chat/completions", model: { values: ["glm-4-flash"] } });
  });

  it("zai-sdk: ZaiClient on api.z.ai, ZhipuAiClient on open.bigmodel.cn", async () => {
    const r = await zai;
    expect(at(r, "assistant.py", 10)).toMatchObject({ provider: "zai", host: "api.z.ai", pathTemplate: "/api/paas/v4/chat/completions", authScheme: "bearer", model: { values: ["glm-4.6"] } });
    expect(keys(at(r, "assistant.py", 10))).toEqual(["messages", "model", "thinking"]);
    expect(at(r, "assistant.py", 14)).toMatchObject({ host: "open.bigmodel.cn", pathTemplate: "/api/paas/v4/chat/completions", model: { values: ["glm-4.5-air"] } });
    expect(at(r, "assistant.py", 18)).toMatchObject({ host: "api.z.ai", pathTemplate: "/api/paas/v4/reader" });
    expect(at(r, "assistant.py", 22)).toMatchObject({ pathTemplate: "/api/paas/v4/web_search" });
    expect(at(r, "assistant.py", 26)).toMatchObject({ host: "open.bigmodel.cn", pathTemplate: "/api/paas/v4/audio/speech", model: { values: ["cogtts"] } });
    expect(at(r, "assistant.py", 30)).toMatchObject({ method: "GET", pathTemplate: "/api/paas/v4/batches/{batch_id}" });
    expect(at(r, "assistant.py", 34)).toMatchObject({ method: "GET", host: "open.bigmodel.cn", pathTemplate: "/api/paas/v4/voice/list" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([
      ["zai-sdk", "ok"],
      ["zhipuai", "ok"],
    ]);
  });
});

describe("google-cloud-aiplatform (Vertex AI)", () => {
  const vertex = scanFixture("python/sdk/vertexai");
  const model = (v: string, project: string, location: string, m: string, verb: string): string => `/${v}/projects/${project}/locations/${location}/publishers/google/models/${m}:${verb}`;
  const ga = (m: string, verb = "generateContent"): string => model("v1", "lumen-press", "europe-west4", m, verb);

  it("GenerativeModel: the constructor's model, `{project}` / `{location}` from the project's one vertexai.init", async () => {
    const r = await vertex;
    expect(at(r, "copywriter.py", 12)).toMatchObject({ provider: "google-vertex", method: "POST", host: "{location}-aiplatform.googleapis.com", pathTemplate: ga("gemini-2.0-flash"), authScheme: "bearer", model: { values: ["gemini-2.0-flash"] } });
    expect(keys(at(r, "copywriter.py", 12))).toEqual(["contents", "generation_config"]);
    // `stream=True` picks the streaming method and is no body field
    expect(at(r, "copywriter.py", 16)).toMatchObject({ pathTemplate: ga("gemini-2.0-flash", "streamGenerateContent") });
    expect(keys(at(r, "copywriter.py", 16))).toEqual(["contents"]);
    expect(at(r, "copywriter.py", 20)).toMatchObject({ pathTemplate: ga("gemini-2.0-flash") });
    expect(at(r, "copywriter.py", 24)).toMatchObject({ pathTemplate: ga("gemini-2.0-flash", "countTokens") });
    expect(at(r, "copywriter.py", 29)).toMatchObject({ pathTemplate: ga("gemini-2.0-flash"), model: { values: ["gemini-2.0-flash"] } });
    expect(at(r, "copywriter.py", 33)).toMatchObject({ pathTemplate: ga("{model}"), model: { values: [], env: "COPY_MODEL" } });
    // the preview module is Vertex AI's v1beta1 API
    expect(at(r, "drafts.py", 5)).toMatchObject({ pathTemplate: model("v1beta1", "lumen-press", "europe-west4", "gemini-1.5-pro", "generateContent") });
  });

  it("Model Garden models: `from_pretrained`'s model, the publisher model's :predict", async () => {
    const r = await vertex;
    expect(at(r, "media.py", 8)).toMatchObject({ pathTemplate: ga("text-embedding-005", "predict"), model: { values: ["text-embedding-005"] } });
    expect(at(r, "media.py", 12)).toMatchObject({ pathTemplate: ga("imagen-3.0-generate-002", "predict"), model: { values: ["imagen-3.0-generate-002"] } });
  });

  it("aiplatform.Endpoint: the pieces of a full endpoint name, else the init call's; an unreadable name gives none", async () => {
    const r = await vertex;
    expect(at(r, "scoring.py", 9)).toMatchObject({ pathTemplate: "/v1/projects/lumen-press/locations/us-east1/endpoints/4417:predict" });
    expect(keys(at(r, "scoring.py", 9))).toEqual(["instances"]);
    expect(at(r, "scoring.py", 13)).toMatchObject({ pathTemplate: "/v1/projects/lumen-press/locations/europe-west4/endpoints/9921:predict" });
    expect(keys(at(r, "scoring.py", 13))).toEqual(["instances", "parameters"]);
    expect(at(r, "scoring.py", 17)).toMatchObject({ pathTemplate: "/v1/projects/{project}/locations/{location}/endpoints/{endpoint}:predict" });
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["google-cloud-aiplatform", "ok"]]);
  });
});

describe("google-cloud-bigquery", () => {
  const bq = scanFixture("python/sdk/bigquery");
  const v2 = (p: string): string => `/bigquery/v2/projects/${p}`;

  it("query jobs on the client's project, the SQL as the field the API takes", async () => {
    const r = await bq;
    expect(at(r, "warehouse.py", 9)).toMatchObject({ provider: "google", method: "POST", host: "bigquery.googleapis.com", pathTemplate: v2("orchard-metrics/jobs"), authScheme: "bearer", bodyEncoding: "json" });
    expect(at(r, "warehouse.py", 9).body).toMatchObject({ properties: { configuration: { properties: { query: { properties: { query: { type: "string" } } } } } } });
    expect(at(r, "warehouse.py", 10)).toMatchObject({ method: "GET", pathTemplate: v2("orchard-metrics/queries/{job_id}") });
    expect(at(r, "warehouse.py", 14)).toMatchObject({ pathTemplate: v2("orchard-metrics/queries") });
    expect(keys(at(r, "warehouse.py", 14))).toEqual(["query"]);
  });

  it("table and dataset ids: the pieces of a dotted id, the client's project when it names none", async () => {
    const r = await bq;
    expect(at(r, "warehouse.py", 18)).toMatchObject({ pathTemplate: v2("orchard-metrics/datasets/telemetry/tables/events/insertAll") });
    expect(at(r, "warehouse.py", 22)).toMatchObject({ pathTemplate: v2("orchard-metrics/datasets/telemetry/tables/clicks/insertAll") });
    // an id the scan cannot read may name the project too: no piece of it is known
    expect(at(r, "warehouse.py", 26)).toMatchObject({ pathTemplate: v2("{project}/datasets/{dataset}/tables/{table}/insertAll") });
    expect(at(r, "warehouse.py", 30)).toMatchObject({ method: "GET", pathTemplate: v2("orchard-metrics/datasets/{dataset}/tables/orders") });
    expect(at(r, "warehouse.py", 34)).toMatchObject({ method: "GET", pathTemplate: v2("orchard-metrics/datasets/sales/tables/orders/data") });
    expect(at(r, "warehouse.py", 38)).toMatchObject({ method: "DELETE", pathTemplate: v2("orchard-metrics/datasets/sales/tables/orders_staging") });
    // a `Table(...)` object is not read
    expect(at(r, "warehouse.py", 42)).toMatchObject({ method: "POST", pathTemplate: v2("{project}/datasets/{dataset}/tables") });
    expect(at(r, "warehouse.py", 46)).toMatchObject({ method: "POST", pathTemplate: v2("orchard-metrics/jobs") });
    expect(at(r, "warehouse.py", 50)).toMatchObject({ method: "POST", pathTemplate: "/upload/bigquery/v2/projects/orchard-metrics/jobs" });
    // `project.dataset` for a dataset
    const datasets = r.calls.filter((c) => c.location.file === "warehouse.py" && c.location.line === 54).map((c) => c.pathTemplate);
    expect(datasets.sort()).toEqual([v2("archive/datasets/sales_2023"), v2("orchard-metrics/datasets")]);
    expect(r.coverage?.sdks.map((s) => [s.package, s.status])).toEqual([["google-cloud-bigquery", "ok"]]);
  });
});
