import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configAt, loadConfig } from "../../src/model/config-files.js";
import { readEnvExamples, exampleValue } from "../../src/model/env-examples.js";
import { mapModelValues, mergeModels, modelFromShape } from "../../src/model/fact.js";
import { asDefault, withSource } from "../../src/model/value-sources.js";
import { yamlData } from "../../src/model/yaml-data.js";
import { alternativesOf } from "../../src/resolve/shape-utils.js";
import { mergeLiterals } from "../../src/resolve/type-shape.js";
import type { Shape } from "../../src/types.js";

const lit = (v: string): Shape => ({ type: "string", enum: [v] });

describe("value sources", () => {
  it("lists where each value that is no literal comes from, a literal winning", () => {
    const fromFile = withSource(lit("gpt-4o"), { from: "config_file", file: "config.yaml", key: "llm.model" });
    const shape: Shape = { type: "union", anyOf: [lit("o3"), asDefault(lit("gpt-4o-mini")), fromFile, asDefault(lit("o3"))] };
    expect(modelFromShape(shape, "body")).toEqual({
      values: ["o3", "gpt-4o-mini", "gpt-4o"],
      dynamic: false,
      sources: [
        { value: "gpt-4o-mini", from: "default" },
        { value: "gpt-4o", from: "config_file", file: "config.yaml", key: "llm.model" },
      ],
      from: "body",
    });
  });

  it("keeps a config file's source through a fallback, and sources through merged literals", () => {
    const fromFile = withSource(lit("gpt-4o"), { from: "config_file", file: "c.json" });
    expect(modelFromShape(asDefault(fromFile), "body")?.sources).toEqual([{ value: "gpt-4o", from: "config_file", file: "c.json" }]);
    const merged = mergeLiterals([asDefault(lit("a")), lit("b")])!;
    expect(modelFromShape(merged, "body")?.sources).toEqual([{ value: "a", from: "default" }]);
  });

  it("keeps literal alternatives beside a string with no value, unlike unionOf", () => {
    const typed: Shape = { type: "string", hint: "model" };
    expect(alternativesOf([typed, lit("gpt-4o")])).toEqual({ type: "union", anyOf: [lit("gpt-4o"), typed] });
    expect(alternativesOf([{ type: "string", env: "MODEL" }, lit("gpt-4o")])).toEqual({ type: "union", anyOf: [{ type: "string", env: "MODEL" }, lit("gpt-4o")] });
    expect(alternativesOf([lit("a"), lit("b")])).toEqual({ type: "string", enum: ["a", "b"] });
    // a side with several values (a declared `"a" | "b"`) keeps them all
    expect(alternativesOf([{ type: "string", enum: ["a", "b"] }, lit("c")])).toEqual({ type: "string", enum: ["a", "b", "c"] });
  });

  it("renames and merges model facts with their sources", () => {
    const m = { values: ["anthropic/claude-sonnet-4"], dynamic: false, sources: [{ value: "anthropic/claude-sonnet-4", from: "default" as const }], from: "argument" as const };
    expect(mapModelValues(m, (v) => v.replace(/^anthropic\//, ""))).toEqual({ ...m, values: ["claude-sonnet-4"], sources: [{ value: "claude-sonnet-4", from: "default" }] });
    const literal = { values: ["claude-sonnet-4"], dynamic: true, from: "argument" as const };
    expect(mergeModels(mapModelValues(m, (v) => v.replace(/^anthropic\//, "")), literal)).toEqual({ values: ["claude-sonnet-4"], dynamic: true, from: "argument" });
  });
});

describe("yamlData", () => {
  it("reads nested block mappings and scalars, the first document only", () => {
    const text = "llm:\n  model: gpt-4o  # chat\n  temperature: 0.2\n  stream: true\n  tags:\n    - a\n  extra: ~\n'quoted key': \"v\"\n---\nllm:\n  model: other\n";
    expect(JSON.parse(JSON.stringify(yamlData(text)))).toEqual({ llm: { model: "gpt-4o", temperature: 0.2, stream: true, extra: null }, "quoted key": "v" });
  });

  it("leaves block scalars, flow collections and anchors out", () => {
    expect(JSON.parse(JSON.stringify(yamlData("a: |\n  text\nb: [1, 2]\nc: &x 1\nd: ok\n")))).toEqual({ d: "ok" });
  });
});

describe("config files and example env files", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-model-sources-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("loads a config file next to the code, else at the scanned directory, never above it", () => {
    fs.mkdirSync(path.join(dir, "app"));
    fs.writeFileSync(path.join(dir, "app", "settings.json"), '{"llm": {"model": "o3"}}');
    fs.writeFileSync(path.join(dir, "config.toml"), '[llm]\nmodel = "gpt-4.1"\n');
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    const from = path.join(dir, "app", "main.py");
    const json = loadConfig("settings.json", from, dir)!;
    expect(json.file).toBe("app/settings.json");
    expect(configAt(json.data, ["llm", "model"])).toBe("o3");
    expect(configAt(loadConfig("config.toml", from, dir)!.data, ["llm", "model"])).toBe("gpt-4.1");
    expect(loadConfig("broken.json", from, dir)).toBeUndefined();
    expect(loadConfig("../outside.json", path.join(dir, "main.py"), dir)).toBeUndefined();
    expect(loadConfig("/etc/hosts.json", from, dir)).toBeUndefined();
    expect(loadConfig("notes.txt", from, dir)).toBeUndefined();
  });

  it("reads commented-out assignments after the others, and none a comment gives several values", () => {
    fs.writeFileSync(path.join(dir, ".env.example"), "# A=gpt-4o\nA=o3\n# B='claude-haiku-4-5'\n# C=x-model\n# C=y-model\nD=my-deployment\n");
    fs.writeFileSync(path.join(dir, "env.example"), "E=gpt-4o-mini\n");
    const examples = readEnvExamples(dir);
    expect(exampleValue(examples, "app.py", "A")).toEqual({ value: "o3", file: ".env.example" });
    expect(exampleValue(examples, "app.py", "B")).toEqual({ value: "claude-haiku-4-5", file: ".env.example", commented: true });
    expect(exampleValue(examples, "app.py", "C")).toBeUndefined();
    expect(exampleValue(examples, "app.py", "D")).toBeUndefined();
    expect(exampleValue(examples, "app.py", "E")).toEqual({ value: "gpt-4o-mini", file: "env.example" });
  });
});
