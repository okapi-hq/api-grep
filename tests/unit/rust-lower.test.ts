import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Expr, FunctionDef, ModuleModel } from "../../src/lang/ir/model.js";
import { lowerRust } from "../../src/lang/rust/lower.js";
import { rustModulePath } from "../../src/lang/rust/names.js";
import { repairRust } from "../../src/lang/rust/repair.js";
import { renamed } from "../../src/lang/rust/structs-lower.js";
import { parserFor } from "../../src/lang/tree-sitter.js";

/** A crate `billing` with the file at `src/<rel>`. */
function crateDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "api-grep-rust-"));
  mkdirSync(path.join(dir, "src", "api"), { recursive: true });
  writeFileSync(path.join(dir, "Cargo.toml"), '[package]\nname = "billing-svc"\nversion = "0.1.0"\n');
  return dir;
}

const DIR = crateDir();

async function lower(code: string, rel = "api/client.rs"): Promise<ModuleModel> {
  const parser = await parserFor("rust");
  const tree = parser.parse(code)!;
  try {
    return lowerRust(tree.rootNode, path.join(DIR, "src", rel), DIR);
  } finally {
    tree.delete();
    parser.delete();
  }
}

const valueOf = (fn: FunctionDef, name: string): Expr | undefined => fn.assigns.find((a) => a.target === name)?.value;

describe("rust lowering: modules and paths", () => {
  it("names modules after the crate and their path under src/", () => {
    expect(rustModulePath(path.join(DIR, "src", "lib.rs"), DIR)).toEqual({ module: ["billing_svc"], root: ["billing_svc"] });
    expect(rustModulePath(path.join(DIR, "src", "api", "mod.rs"), DIR).module).toEqual(["billing_svc", "api"]);
    expect(rustModulePath(path.join(DIR, "src", "api", "client.rs"), DIR).module).toEqual(["billing_svc", "api", "client"]);
    expect(rustModulePath(path.join(DIR, "src", "bin", "sync.rs"), DIR)).toEqual({ module: ["billing_svc", "bin", "sync"], root: ["billing_svc", "bin", "sync"] });
    expect(rustModulePath(path.join(DIR, "examples", "demo.rs"), DIR).root).toEqual(["billing_svc", "examples", "demo"]);
  });

  it("reads use declarations: aliases, lists, self, globs, crate / super / self paths", async () => {
    const m = await lower("use reqwest::Client as Http;\nuse crate::config::{self, BASE_URL};\nuse super::models::*;\nuse self::inner::Thing;\nuse std::{env, collections::HashMap};\nmod inner;\n");
    expect(m.name).toBe("billing_svc.api.client");
    expect([...m.imports].map(([alias, ref]) => [alias, ref.path.join(".")])).toEqual([
      ["Http", "reqwest.Client"],
      ["config", "billing_svc.config"],
      ["BASE_URL", "billing_svc.config.BASE_URL"],
      ["Thing", "billing_svc.api.client.inner.Thing"],
      ["env", "std.env"],
      ["HashMap", "std.collections.HashMap"],
    ]);
    expect(m.wildcards).toEqual([["billing_svc", "api", "models"]]);
  });

  it("makes paths absolute: crates, use aliases, child modules, items of the file and Self", async () => {
    const m = await lower(
      'use reqwest::Client as Http;\nmod config;\nstruct Api;\nimpl Api {\n  const BASE: &str = "https://x.example";\n  fn f(&self) {\n    let a = Http::new();\n    let b = reqwest::blocking::get(u);\n    let c = config::URL;\n    let d = Api::BASE;\n    let e = Self::BASE;\n    let g = super::helpers::URL;\n  }\n}\n',
    );
    const f = m.classes.get("Api")!.methods.get("f")!;
    expect(valueOf(f, "a")).toMatchObject({ k: "call", fn: { k: "attr", name: "new", obj: { k: "qname", path: ["reqwest", "Client"] } } });
    expect(valueOf(f, "b")).toMatchObject({ k: "call", fn: { k: "attr", name: "get", obj: { k: "qname", path: ["reqwest", "blocking"] } } });
    expect(valueOf(f, "c")).toMatchObject({ k: "attr", name: "URL", obj: { k: "qname", path: ["billing_svc", "api", "client", "config"] } });
    expect(valueOf(f, "d")).toMatchObject({ k: "attr", name: "BASE", obj: { k: "name", name: "Api" } });
    expect(valueOf(f, "e")).toMatchObject({ k: "attr", name: "BASE", obj: { k: "name", name: "Api" } });
    expect(valueOf(f, "g")).toMatchObject({ k: "attr", name: "URL", obj: { k: "qname", path: ["billing_svc", "api", "helpers"] } });
    expect(m.classes.get("Api")!.fields.get("BASE")?.[0]?.value).toEqual({ k: "str", v: "https://x.example" });
  });

  it("lowers an inline module as a class of the file and skips #[cfg(test)] modules and #[test] functions", async () => {
    const m = await lower('mod urls {\n  pub const API: &str = "https://a.example";\n  pub fn base() -> String { API.to_string() }\n}\n#[cfg(test)]\nmod tests {\n  fn t() {}\n}\n#[test]\nfn check() {}\n');
    const urls = m.classes.get("urls")!;
    expect(urls.qname).toBe("billing_svc.api.client.urls");
    expect(urls.fields.get("API")?.[0]?.value).toEqual({ k: "str", v: "https://a.example" });
    expect(urls.methods.get("base")?.returns).toMatchObject([{ k: "name", name: "API" }]);
    expect(m.allFunctions.map((f) => f.name)).toEqual(["<file>", "base"]);
  });
});

describe("rust lowering: values", () => {
  it("reads strings, consts, statics, format! with positional, named and captured arguments, concat! and env reads", async () => {
    const m = await lower(
      'const BASE: &str = "https://api.example.com";\nconst RAW: &str = r#"a"b"#;\nstatic V: &str = concat!("https://", "x.example");\nfn f(id: u64) {\n  let a = format!("{}/v{n}/items/{id}", BASE, n = 2);\n  let k = std::env::var("API_KEY").unwrap();\n  let d = env::var("BASE").unwrap_or_else(|_| "https://d.example".into());\n  let o = dotenvy::var("X").unwrap_or("y".to_string());\n  let e = env!("BUILD_URL");\n  let s = String::from("a\\tb") + "/c";\n}\n',
    );
    const f = m.functions.get("f")!;
    expect(valueOf(m.top, "RAW")).toEqual({ k: "str", v: 'a"b' });
    expect(valueOf(m.top, "V")).toEqual({ k: "concat", parts: [{ k: "str", v: "https://" }, { k: "str", v: "x.example" }] });
    const a = valueOf(f, "a") as Extract<Expr, { k: "format" }>;
    expect(a).toMatchObject({ k: "format", style: "brace", template: { k: "str", v: "{}/v{n}/items/{id}" } });
    expect(a.args.map((x) => x.name ?? (x.value.k === "name" ? x.value.name : x.value.k))).toEqual(["BASE", "n", "id"]);
    expect(valueOf(f, "k")).toEqual({ k: "env", name: "API_KEY" });
    expect(valueOf(f, "d")).toEqual({ k: "or", left: { k: "env", name: "BASE" }, right: { k: "str", v: "https://d.example" } });
    expect(valueOf(f, "o")).toEqual({ k: "or", left: { k: "env", name: "X" }, right: { k: "str", v: "y" } });
    expect(valueOf(f, "e")).toEqual({ k: "env", name: "BUILD_URL" });
    expect(valueOf(f, "s")).toEqual({ k: "concat", parts: [{ k: "str", v: "a\tb" }, { k: "str", v: "/c" }] });
    // conversions and error handling stand for their value: nothing is recorded but the env reads' arguments
    expect(f.calls).toEqual([]);
  });

  it("reads json! values: objects, arrays, literals and Rust code", async () => {
    const m = await lower('fn f(prompt: &str) {\n  let b = serde_json::json!({ "model": "gpt-4o", "n": -1, "stream": true, "stop": null, "messages": [{ "role": "user", "content": prompt }], "t": self.temp });\n}\n');
    expect(valueOf(m.functions.get("f")!, "b")).toMatchObject({
      k: "dict",
      entries: [
        { key: { k: "str", v: "model" }, value: { k: "str", v: "gpt-4o" } },
        { key: { k: "str", v: "n" }, value: { k: "num", v: -1 } },
        { key: { k: "str", v: "stream" }, value: { k: "bool", v: true } },
        { key: { k: "str", v: "stop" }, value: { k: "null" } },
        { key: { k: "str", v: "messages" }, value: { k: "list", items: [{ k: "dict", entries: [{}, { value: { k: "name", name: "prompt" } }] }] } },
        { key: { k: "str", v: "t" }, value: { k: "attr", name: "temp", obj: { k: "this" } } },
      ],
    });
  });

  it("keeps positions of macro arguments in the file", async () => {
    const m = await lower('fn f() {\n  let u = format!(\n    "{}/x",\n    base_url(),\n  );\n}\n');
    const call = m.functions.get("f")!.calls[0]!;
    expect(call.pos).toMatchObject({ line: 4, col: 5 });
  });

});

describe("rust lowering: structs and statements", () => {
  it("reads struct literals, serde names, match and if values, closures and assignments", async () => {
    const m = await lower(
      '#[derive(Serialize)]\n#[serde(rename_all = "camelCase")]\nstruct Req {\n  #[serde(rename = "q")] query: String,\n  max_tokens: Option<u32>,\n  #[serde(skip)] secret: String,\n}\nfn f(k: Option<&str>) {\n  let r = Req { query: q, max_tokens: None, ..Default::default() };\n  let v = match k { Some(x) => x, None => "d" };\n  let w = if k.is_some() { "a" } else { "b" };\n  let mut body = json!({});\n  body["stream"] = json!(true);\n  let mut url = String::new();\n  url.push_str("/v1");\n}\n',
    );
    const cls = m.classes.get("Req")!;
    expect(cls.annotations.map((a) => [a.name, a.optional, a.field])).toEqual([
      ["q", false, "query"],
      ["maxTokens", true, "max_tokens"],
    ]);
    const f = m.functions.get("f")!;
    expect(valueOf(f, "r")).toMatchObject({ k: "call", isNew: true, fn: { k: "name", name: "Req" }, args: [{ name: "query" }, { name: "max_tokens", value: { k: "null" } }] });
    expect(valueOf(f, "v")).toMatchObject({ k: "cond", then: { k: "name", name: "x" }, else: { k: "str", v: "d" } });
    expect(valueOf(f, "x")).toMatchObject({ k: "name", name: "k" });
    expect(valueOf(f, "w")).toEqual({ k: "cond", then: { k: "str", v: "a" }, else: { k: "str", v: "b" } });
    expect(f.assigns.find((a) => a.target === "body" && a.edit)).toMatchObject({ edit: "merge", value: { k: "dict", entries: [{ key: { k: "str", v: "stream" } }] } });
    expect(f.assigns.filter((a) => a.target === "url").map((a) => [a.value, !!a.augmented])).toEqual([
      [{ k: "str", v: "" }, false],
      [{ k: "str", v: "/v1" }, true],
    ]);
  });

  it("applies serde's rename_all rules", () => {
    expect(renamed("max_tokens", "camelCase")).toBe("maxTokens");
    expect(renamed("max_tokens", "PascalCase")).toBe("MaxTokens");
    expect(renamed("max_tokens", "kebab-case")).toBe("max-tokens");
    expect(renamed("max_tokens", "SCREAMING_SNAKE_CASE")).toBe("MAX_TOKENS");
    expect(renamed("max_tokens", undefined)).toBe("max_tokens");
  });
});

describe("rust repair", () => {
  it("rewrites `&raw` borrows of a variable and blanks cfg attributes on pattern fields, without moving a position", async () => {
    const text = 'fn f(raw: &str) {\n  g(&raw);\n  let u = "https://x.example/?a=1&raw=true";\n  let p = &raw const x;\n  let Config {\n    #[cfg(feature = "tls")]\n    tls,\n    port,\n  } = c;\n}\n';
    const fixed = repairRust(text);
    expect(fixed).toHaveLength(text.length);
    expect(fixed).toContain("g(*raw);");
    expect(fixed).toContain("?a=1&raw=true");
    expect(fixed).toContain("&raw const x");
    expect(fixed).not.toContain("#[cfg");
    const parser = await parserFor("rust");
    const tree = parser.parse(fixed)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
    } finally {
      tree.delete();
      parser.delete();
    }
  });
});
