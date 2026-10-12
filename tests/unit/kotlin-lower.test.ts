import { describe, expect, it } from "vitest";
import type { Expr, ModuleModel } from "../../src/lang/ir/model.js";
import { lowerKotlin } from "../../src/lang/kotlin/lower.js";
import { semicolonsBeforeBraces } from "../../src/lang/kotlin/repair.js";
import { parserFor, syntaxError } from "../../src/lang/tree-sitter.js";

async function lower(code: string): Promise<ModuleModel> {
  const parser = await parserFor("kotlin");
  const tree = parser.parse(code)!;
  try {
    return lowerKotlin(tree.rootNode, "/repo/app/src/main/java/Api.kt", "/repo");
  } finally {
    tree.delete();
    parser.delete();
  }
}

const valueOf = (m: ModuleModel, name: string): Expr | undefined => m.top.assigns.find((a) => a.target === name)?.value;
const fieldOf = (m: ModuleModel, cls: string, name: string): Expr | undefined => m.classes.get(cls)?.fields.get(name)?.[0]?.value;

describe("kotlin lowering: files and values", () => {
  it("names the module after its package and reads imports, aliases and whole packages", async () => {
    const m = await lower("package com.example.api\n\nimport okhttp3.OkHttpClient\nimport retrofit2.Retrofit as R\nimport com.example.data.*\n");
    expect(m.name).toBe("com.example.api");
    expect(m.imports.get("OkHttpClient")?.path).toEqual(["okhttp3", "OkHttpClient"]);
    expect(m.imports.get("R")?.path).toEqual(["retrofit2", "Retrofit"]);
    expect(m.wildcards).toEqual([["com", "example", "data"]]);
    expect(m.importPaths.map((p) => p.join("."))).toEqual(["okhttp3.OkHttpClient", "retrofit2.Retrofit", "com.example.data"]);
  });

  it("reads string templates, escapes, raw strings and literals", async () => {
    const m = await lower('val a = "$base/v1/${id}"\nval b = "x\\t\\$y"\nval c = """raw $base\\n"""\nval d = "${\'$\'}{x}"\nval e = 1_000L\nval f = true\nval g = null\nval h = "$a$b"\n');
    expect(valueOf(m, "a")).toMatchObject({ k: "tmpl", parts: [{ k: "name", name: "base" }, { k: "str", v: "/v1/" }, { k: "name", name: "id" }] });
    expect(valueOf(m, "b")).toEqual({ k: "str", v: "x\t$y" });
    expect(valueOf(m, "c")).toMatchObject({ k: "tmpl", parts: [{ k: "str", v: "raw " }, { k: "name", name: "base" }, { k: "str", v: "\\n" }] });
    expect(valueOf(m, "d")).toEqual({ k: "str", v: "${x}" });
    expect(valueOf(m, "e")).toEqual({ k: "num", v: 1000 });
    expect(valueOf(m, "f")).toEqual({ k: "bool", v: true });
    expect(valueOf(m, "g")).toEqual({ k: "null" });
    expect(valueOf(m, "h")).toMatchObject({ k: "tmpl", parts: [{ k: "name", name: "a" }, { k: "name", name: "b" }] });
  });

  it("reads configuration: environment, system properties, BuildConfig and Spring @Value", async () => {
    const m = await lower(
      'val a = System.getenv("API") ?: "https://a"\nval b = System.getProperty("api.url", "https://b")\nval c = System.getenv()["KEY"]\nval d = System.getenv().getOrDefault("X", "https://d")\nval e = BuildConfig.API_URL\nclass S(@Value("\\${api.base:https://s}") private val base: String)\n',
    );
    expect(valueOf(m, "a")).toEqual({ k: "or", left: { k: "env", name: "API" }, right: { k: "str", v: "https://a" } });
    expect(valueOf(m, "b")).toEqual({ k: "env", name: "api.url", fallback: { k: "str", v: "https://b" } });
    expect(valueOf(m, "c")).toEqual({ k: "env", name: "KEY" });
    expect(valueOf(m, "d")).toEqual({ k: "env", name: "X", fallback: { k: "str", v: "https://d" } });
    expect(valueOf(m, "e")).toEqual({ k: "env", name: "API_URL" });
    expect(m.classes.get("S")!.methods.get("<init>")!.params[0]!.default).toEqual({ k: "env", name: "api.base", fallback: { k: "str", v: "https://s" } });
  });

});

describe("kotlin lowering: calls and classes", () => {
  it("reads string formatting and building, and collection literals", async () => {
    const m = await lower(
      'val a = String.format("%s/x/%d", base, id)\nval b = "%s/y".format(base)\nval c = buildString { append(base); append("/z") }\nval d = StringBuilder(base).append("/w").toString()\nval e = mapOf("a" to 1, "b" to x)\nval f = listOf(1, 2)\n',
    );
    expect(valueOf(m, "a")).toMatchObject({ k: "format", style: "printf", template: { k: "str", v: "%s/x/%d" }, args: [{ value: { k: "name", name: "base" } }, { value: { k: "name", name: "id" } }] });
    expect(valueOf(m, "b")).toMatchObject({ k: "format", template: { k: "str", v: "%s/y" } });
    expect(valueOf(m, "c")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/z" }] });
    expect(valueOf(m, "d")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/w" }] });
    expect(valueOf(m, "e")).toMatchObject({ k: "dict", entries: [{ key: { k: "str", v: "a" } }, { key: { k: "str", v: "b" }, value: { k: "name", name: "x" } }] });
    expect(valueOf(m, "f")).toMatchObject({ k: "list", items: [{ k: "num", v: 1 }, { k: "num", v: 2 }] });
  });

  it("makes constructor properties, initializers, lazy delegates, getters and companion members fields of the class", async () => {
    const m = await lower(
      'class Api(private val client: OkHttpClient, base: String = BASE) {\n  companion object { const val BASE = "https://x" }\n  private val url = "$base/v1"\n  val retrofit by lazy { Retrofit.Builder().baseUrl(url).build() }\n  val health get() = "$url/health"\n  lateinit var token: String\n  init { token = "t" }\n  fun get(path: String) = client.get("$url/$path")\n}\n',
    );
    const cls = m.classes.get("Api")!;
    expect([...cls.fields.keys()]).toEqual(["client", "Companion", "BASE", "url", "retrofit", "health", "token"]);
    expect(cls.methods.get("<init>")!.params.map((p) => [p.name, p.default?.k])).toEqual([
      ["client", undefined],
      ["base", "attr"],
    ]);
    // `base` in an initializer is the constructor parameter; `url` in a method is the property (`this.url`)
    expect(fieldOf(m, "Api", "url")).toMatchObject({ k: "tmpl", parts: [{ k: "name", name: "base" }, { k: "str", v: "/v1" }] });
    expect(fieldOf(m, "Api", "retrofit")).toMatchObject({ k: "call", fn: { k: "fnref" }, args: [] });
    expect(cls.methods.get("get")!.returns[0]).toMatchObject({ k: "call", fn: { k: "attr", obj: { k: "attr", obj: { k: "this" }, name: "client" }, name: "get" } });
    expect(cls.fields.get("BASE")![0]!.fn.name).toBe("<clinit>");
    expect(cls.fields.get("token")![0]!.value).toEqual({ k: "str", v: "t" });
    expect(cls.fieldTypes.get("client")).toMatchObject({ k: "name", name: "OkHttpClient" });
  });

});

describe("kotlin lowering: scopes, shapes and annotations", () => {
  it("lets a local shadow a member, and gives a let lambda's `it` its receiver", async () => {
    const m = await lower('class A(val url: String) {\n  fun a(): String { val url = "local"; return url }\n  fun b() = url\n  fun c() = host?.let { "https://$it" }\n}\n');
    const cls = m.classes.get("A")!;
    expect(cls.methods.get("a")!.returns[0]).toMatchObject({ k: "name", name: "url" });
    expect(cls.methods.get("b")!.returns[0]).toMatchObject({ k: "attr", obj: { k: "this" }, name: "url" });
    const lambda = m.allFunctions.find((f) => f.name === "lambda")!;
    expect(lambda.params[0]).toMatchObject({ name: "it", default: { k: "name", name: "host" } });
    expect(lambda.returns[0]).toMatchObject({ k: "tmpl", parts: [{ k: "str", v: "https://" }, { k: "name", name: "it" }] });
  });

  it("reads request body classes with their JSON names and optional properties", async () => {
    const m = await lower(
      'data class Order(@SerializedName("order_id") val id: String, @Json(name = "total") val amount: Int?, val items: List<Item> = emptyList(), @Transient val cache: String = "")\n',
    );
    expect(m.classes.get("Order")!.annotations.map((a) => [a.name, a.optional, a.type.k])).toEqual([
      ["order_id", false, "name"],
      ["total", true, "name"],
      ["items", true, "index"],
    ]);
  });

  it("keeps the annotations of functions and parameters, nested classes, and named and trailing-lambda arguments", async () => {
    const m = await lower(
      'interface GitHub {\n  @GET("users/{user}/repos")\n  suspend fun repos(@Path("user") user: String, @Query("per_page") n: Int = 30): List<Repo>\n}\nobject Outer { class Inner }\nval x = fetch(limit = 10, *ids) { it }\n',
    );
    const repos = m.classes.get("GitHub")!.methods.get("repos")!;
    expect(repos.annotations).toMatchObject([{ type: { k: "name", name: "GET" }, args: [{ value: { k: "str", v: "users/{user}/repos" } }] }]);
    expect(repos.params.map((p) => [p.name, p.annotations?.[0]?.type, p.default])).toMatchObject([
      ["user", { name: "Path" }, undefined],
      ["n", { name: "Query" }, { k: "num", v: 30 }],
    ]);
    expect(m.classes.get("Outer.Inner")?.qname).toBe("Outer.Inner");
    expect(m.classes.get("Outer")!.fields.get("Inner")![0]!.value).toMatchObject({ k: "qname", path: ["Outer", "Inner"] });
    expect(valueOf(m, "x")).toMatchObject({ k: "call", args: [{ name: "limit" }, { spread: "list" }, { value: { k: "fnref" } }] });
  });

});

describe("kotlin parsing", () => {
  it("reads class bodies closed on their member's line, which the grammar marks with hidden or real errors", async () => {
    const parser = await parserFor("kotlin");
    const one = "object B { fun f() {} }\n";
    const two = 'class A {\n  companion object { const val X = 1 }\n}\nclass C {\n  companion object { const val S = "a }" }\n}\n';
    const trees = [one, two, semicolonsBeforeBraces(two), "class A { val y = }\n"].map((code) => parser.parse(code)!);
    try {
      expect(syntaxError(trees[0]!)).toBe("syntax error");
      expect(syntaxError(trees[0]!, true)).toBeUndefined();
      expect(syntaxError(trees[1]!, true)).toMatch(/^syntax error at line \d+$/);
      // the rewrite keeps every position and leaves strings, interpolations and separated statements alone
      expect(semicolonsBeforeBraces(two)).toBe('class A {\n  companion object { const val X = 1;}\n}\nclass C {\n  companion object { const val S = "a }";}\n}\n');
      expect(syntaxError(trees[2]!)).toBeUndefined();
      expect(syntaxError(trees[3]!, true)).toBe("syntax error at line 1");
      const untouched = 'list.map { x -> }\n/* { a } */ val c = \'}\' // { b }\nval t = "${s }"\nval r = """{ $x }"""\n';
      expect(semicolonsBeforeBraces(untouched)).toBe(untouched);
    } finally {
      for (const t of trees) t.delete();
      parser.delete();
    }
  });
});
