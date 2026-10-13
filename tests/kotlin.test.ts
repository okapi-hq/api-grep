import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { languageFiles } from "../src/lang/files.js";
import { evaluate } from "../src/lang/ir/evaluate.js";
import type { ClassDef, FunctionDef, ModuleModel } from "../src/lang/ir/model.js";
import { ProjectIndex } from "../src/lang/ir/project.js";
import { kotlinLanguage } from "../src/lang/kotlin/index.js";
import { parserFor } from "../src/lang/tree-sitter.js";
import { partsToTemplate } from "../src/resolve/parts.js";
import { FIXTURES, scanFixture } from "./fixture-helpers.js";

describe("kotlin: an Android project", () => {
  it("reads every source file, leaves build scripts and tests out, and compares the Maven SDKs with the calls", async () => {
    const r = await scanFixture("kotlin/android", { exclude: [] });
    // the Retrofit interface, with the base URL its `create` gets from BuildConfig, and the SDK calls
    expect(r.calls.map((c) => [c.location.file, c.location.line, c.client, c.provider, c.method, c.pathTemplate])).toEqual([
      ["app/src/main/java/com/example/forecast/data/ForecastApi.kt", 7, "retrofit", "open-meteo", "GET", "/v1/forecast"],
      ["app/src/main/java/com/example/forecast/data/ForecastRepository.kt", 16, "sdk", "firebase", "POST", "/v1/projects/{projectId}/databases/(default)/documents/places"],
      ["core/src/main/kotlin/com/example/core/Analytics.kt", 13, "sdk", "posthog", "POST", "/batch"],
    ]);
    expect(r.calls[0]).toMatchObject({ urlTemplate: "{env:FORECAST_URL}/v1/forecast" });
    // `hourly` is left out by the only caller: its default is the value sent
    expect(r.calls[0]).toMatchObject({ queryShape: { properties: { hourly: { type: "string", enum: ["temperature_2m"] } } } });
    // a data class written to Firestore gives the body
    expect(r.calls[1]!.body).toMatchObject({ properties: { place_name: { type: "string" }, lat: { type: "number" } }, fromType: "SavedPlace" });
    expect(r.diagnostics).toMatchObject({ filesSeen: 6, filesScanned: 6, skipped: [], unfollowed: [], languages: { kotlin: { filesSeen: 6, filesScanned: 6 } }, complete: true });
    expect(r.coverage?.sdks.map((s) => [s.package, s.ecosystem, s.provider, s.status, s.importSites])).toEqual([
      ["com.google.firebase:firebase-firestore", "maven", "firebase", "ok", 1],
      ["com.posthog:posthog", "maven", "posthog", "ok", 1],
      ["com.stripe:stripe-android", "maven", "stripe", "unsupported", 1],
      ["io.sentry:sentry-android", "maven", "sentry", "declared-not-imported", 0],
    ]);
  });

  it("is selected with --language kotlin", async () => {
    const r = await scanFixture("kotlin/android", { exclude: [], languages: ["kotlin"] });
    expect(Object.keys(r.diagnostics?.languages ?? {})).toEqual(["kotlin"]);
    const none = await scanFixture("kotlin/android", { exclude: [], languages: ["python"] });
    expect(none.diagnostics?.languages).toEqual({});
  });
});

/** Every Kotlin file of a fixture lowered and indexed, as the scan does before detection. */
async function project(name: string): Promise<ProjectIndex> {
  const root = path.join(FIXTURES, name);
  const parser = await parserFor("kotlin");
  try {
    const mods = languageFiles(root, kotlinLanguage.extensions, undefined, kotlinLanguage.excludes).map((file) => {
      const tree = parser.parse(readFileSync(file, "utf8"))!;
      try {
        return kotlinLanguage.lower(tree.rootNode, file, root);
      } finally {
        tree.delete();
      }
    });
    return new ProjectIndex(kotlinLanguage, mods);
  } finally {
    parser.delete();
  }
}

const classNamed = (idx: ProjectIndex, qname: string): ClassDef => idx.all().flatMap((m: ModuleModel) => [...m.classes.values()]).find((c) => c.qname === qname)!;

/** What the engine reads for a value: a field of a class, or what a method returns. */
function field(idx: ProjectIndex, qname: string, name: string): string {
  const f = classNamed(idx, qname).fields.get(name)![0]!;
  return partsToTemplate(evaluate(f.value, f.fn, { idx }));
}

function returned(idx: ProjectIndex, qname: string, method: string): string {
  const fn: FunctionDef = classNamed(idx, qname).methods.get(method)!;
  return partsToTemplate(evaluate(fn.returns[0]!, fn, { idx }));
}

describe("kotlin: values across files", () => {
  it("reads BuildConfig fields from the module's Gradle file, objects, companions and templates", async () => {
    const idx = await project("kotlin/android");
    const network = classNamed(idx, "com.example.forecast.data.Network");
    const base = network.fields.get("baseUrl")![0]!;
    expect(evaluate(base.value, base.fn, { idx })).toEqual([{ kind: "env", name: "FORECAST_URL", fallback: "https://api.open-meteo.com/" }]);
    expect(returned(idx, "com.example.forecast.data.ForecastRepository", "shareLink")).toBe("{env:FORECAST_URL}v1/forecast?latitude={lat}&longitude={lon}");
    expect(field(idx, "com.example.forecast.data.ForecastRepository", "PLACES")).toBe("places");
    expect(field(idx, "com.example.core.Analytics", "HOST")).toBe("https://eu.i.posthog.com");
  });

  it("keeps the shapes and annotations that request bodies and Retrofit interfaces need", async () => {
    const idx = await project("kotlin/android");
    expect(classNamed(idx, "com.example.forecast.data.SavedPlace").annotations.map((a) => [a.name, a.optional])).toEqual([
      ["place_name", false],
      ["lat", false],
      ["lon", false],
    ]);
    const forecast = classNamed(idx, "com.example.forecast.data.ForecastApi").methods.get("forecast")!;
    expect(forecast.annotations).toMatchObject([{ type: { k: "name", name: "GET" }, args: [{ value: { k: "str", v: "v1/forecast" } }] }]);
    expect(forecast.params.map((p) => [p.name, p.annotations?.[0]?.args[0]?.value, p.default])).toEqual([
      ["latitude", { k: "str", v: "latitude" }, undefined],
      ["longitude", { k: "str", v: "longitude" }, undefined],
      ["hourly", { k: "str", v: "hourly" }, { k: "str", v: "temperature_2m" }],
    ]);
  });
});
