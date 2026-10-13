import { describe, expect, it } from "vitest";
import type { Expr, ModuleModel } from "../../src/lang/ir/model.js";
import { lowerJava } from "../../src/lang/java/lower.js";
import { varargsAnnotations } from "../../src/lang/java/repair.js";
import { parserFor, syntaxError } from "../../src/lang/tree-sitter.js";

async function lower(code: string): Promise<ModuleModel> {
  const parser = await parserFor("java");
  const tree = parser.parse(code)!;
  try {
    expect(syntaxError(tree)).toBeUndefined();
    return lowerJava(tree.rootNode, "/repo/app/src/main/java/Api.java", "/repo");
  } finally {
    tree.delete();
    parser.delete();
  }
}

const fieldOf = (m: ModuleModel, cls: string, name: string): Expr | undefined => m.classes.get(cls)?.fields.get(name)?.[0]?.value;
const localOf = (m: ModuleModel, cls: string, method: string, name: string): Expr | undefined =>
  m.classes.get(cls)?.methods.get(method)?.assigns.find((a) => a.target === name)?.value;

describe("java lowering: files and values", () => {
  it("names the module after its package and reads imports, static imports and whole packages", async () => {
    const m = await lower("package com.example.api;\n\nimport okhttp3.OkHttpClient;\nimport static com.example.Config.BASE_URL;\nimport com.example.data.*;\n");
    expect(m.name).toBe("com.example.api");
    expect(m.imports.get("OkHttpClient")?.path).toEqual(["okhttp3", "OkHttpClient"]);
    expect(m.imports.get("BASE_URL")?.path).toEqual(["com", "example", "Config", "BASE_URL"]);
    expect(m.wildcards).toEqual([["com", "example", "data"]]);
    expect(m.importPaths.map((p) => p.join("."))).toEqual(["okhttp3.OkHttpClient", "com.example.Config.BASE_URL", "com.example.data"]);
  });

  it("reads strings, escapes, text blocks, concatenation and literals", async () => {
    const m = await lower(
      'class A {\n  static final String A = BASE + "/v1/" + ID;\n  static final String B = "x\\t\\"y\\u0041";\n  static final String C = """\n      {"a": 1}\n        b\n      """;\n  static final long D = 1_000L;\n  static final boolean E = true;\n  static final Object F = null;\n  static final char G = \'\\n\';\n}\n',
    );
    expect(fieldOf(m, "A", "A")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "BASE" }, { k: "str", v: "/v1/" }, { k: "name", name: "ID" }] });
    expect(fieldOf(m, "A", "B")).toEqual({ k: "str", v: 'x\t"yA' });
    expect(fieldOf(m, "A", "C")).toEqual({ k: "str", v: '{"a": 1}\n  b\n' });
    expect(fieldOf(m, "A", "D")).toEqual({ k: "num", v: 1000 });
    expect(fieldOf(m, "A", "E")).toEqual({ k: "bool", v: true });
    expect(fieldOf(m, "A", "F")).toEqual({ k: "null" });
    expect(fieldOf(m, "A", "G")).toEqual({ k: "str", v: "\n" });
  });

  it("reads configuration: environment, system properties, Spring @Value and Environment, BuildConfig", async () => {
    const m = await lower(
      'class S {\n  @Value("${api.base:https://s}") private String base;\n  S(@Value("${api.key}") String key) {}\n  void run() {\n    String a = System.getenv("API");\n    String b = System.getProperty("api.url", "https://b");\n    String c = System.getenv().getOrDefault("X", "https://c");\n    String d = env.getProperty("svc.url", "https://d");\n    String e = Optional.ofNullable(System.getenv("E")).orElse("https://e");\n    String f = BuildConfig.API_URL;\n  }\n}\n',
    );
    expect(fieldOf(m, "S", "base")).toEqual({ k: "env", name: "api.base", fallback: { k: "str", v: "https://s" } });
    expect(m.classes.get("S")!.methods.get("<init>")!.params[0]!.default).toEqual({ k: "env", name: "api.key" });
    expect(localOf(m, "S", "run", "a")).toEqual({ k: "env", name: "API" });
    expect(localOf(m, "S", "run", "b")).toEqual({ k: "env", name: "api.url", fallback: { k: "str", v: "https://b" } });
    expect(localOf(m, "S", "run", "c")).toEqual({ k: "env", name: "X", fallback: { k: "str", v: "https://c" } });
    expect(localOf(m, "S", "run", "d")).toEqual({ k: "env", name: "svc.url", fallback: { k: "str", v: "https://d" } });
    expect(localOf(m, "S", "run", "e")).toEqual({ k: "or", left: { k: "env", name: "E" }, right: { k: "str", v: "https://e" } });
    expect(localOf(m, "S", "run", "f")).toEqual({ k: "env", name: "API_URL" });
  });

});

describe("java lowering: strings and URLs", () => {
  it("reads formatting, joining, StringBuilder chains and statements, and collection factories", async () => {
    const m = await lower(
      'class F {\n  void run() {\n    String a = String.format("%s/x/%d", base, id);\n    String b = "%s/y".formatted(base);\n    String c = new StringBuilder(base).append("/z").toString();\n    StringBuilder sb = new StringBuilder();\n    sb.append(base);\n    sb.append("/w").append(id);\n    String d = sb.toString();\n    String e = String.join("/", base, "v");\n    Map<String, Object> f = Map.of("a", 1, "b", x);\n    List<String> g = List.of("x", "y");\n  }\n}\n',
    );
    expect(localOf(m, "F", "run", "a")).toMatchObject({ k: "format", style: "printf", template: { k: "str", v: "%s/x/%d" } });
    expect(localOf(m, "F", "run", "b")).toMatchObject({ k: "format", template: { k: "str", v: "%s/y" } });
    expect(localOf(m, "F", "run", "c")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/z" }] });
    expect(localOf(m, "F", "run", "d")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/w" }, { k: "name", name: "id" }] });
    expect(localOf(m, "F", "run", "e")).toMatchObject({ k: "call", fn: { k: "attr", obj: { k: "str", v: "/" }, name: "join" } });
    expect(localOf(m, "F", "run", "f")).toMatchObject({ k: "dict", entries: [{ key: { k: "str", v: "a" } }, { key: { k: "str", v: "b" } }] });
    expect(localOf(m, "F", "run", "g")).toEqual({ k: "list", items: [{ k: "str", v: "x" }, { k: "str", v: "y" }] });
  });

  it("reads the URL the parts of a multi-argument URI or URL constructor make", async () => {
    const m = await lower('class U {\n  void run() throws Exception {\n    URL a = new URI(scheme, null, host, port, "/v1/items", null, null).toURL();\n    URL b = new URL("https", host, "/v2");\n  }\n}\n');
    expect(localOf(m, "U", "run", "a")).toMatchObject({ k: "call", fn: { k: "attr", name: "toURL", obj: { k: "concat", parts: [{ name: "scheme" }, { v: "://" }, { name: "host" }, { v: "/v1/items" }] } } });
    expect(localOf(m, "U", "run", "b")).toMatchObject({ k: "concat", parts: [{ v: "https" }, { v: "://" }, { name: "host" }, { v: "/v2" }] });
  });
});

describe("java lowering: classes and calls", () => {
  it("reads fields, constants, the widest constructor as <init>, records and enum constants", async () => {
    const m = await lower(
      [
        "package a;",
        "class C {",
        '  private static final String BASE = "https://x";',
        "  private final OkHttpClient http;",
        '  @JsonProperty("full_name") private String name;',
        "  private transient int cache;",
        "  C() { this(BASE); }",
        "  C(String url) { this.url = url; http = new OkHttpClient(); }",
        "  static { init(); }",
        "}",
        'record P(@SerializedName("x_id") long id, String label) {}',
        'enum E { A("/a"), B("/b"); E(String p) {} }',
      ].join("\n"),
    );
    const c = m.classes.get("C")!;
    expect(c.qname).toBe("a.C");
    expect(fieldOf(m, "C", "BASE")).toEqual({ k: "str", v: "https://x" });
    expect(c.fields.get("BASE")![0]!.fn.name).toBe("<clinit>");
    expect(c.methods.get("<init>")!.params.map((p) => p.name)).toEqual(["url"]);
    expect(fieldOf(m, "C", "url")).toMatchObject({ k: "name", name: "url" });
    // a bare field name assigned in the constructor is the field
    expect(fieldOf(m, "C", "http")).toMatchObject({ k: "call", isNew: true, fn: { k: "name", name: "OkHttpClient" } });
    expect(c.fieldTypes.get("http")).toMatchObject({ k: "name", name: "OkHttpClient" });
    expect(c.annotations.map((a) => a.name)).toEqual(["http", "full_name"]);
    const p = m.classes.get("P")!;
    expect(p.annotations).toMatchObject([
      { name: "x_id", type: { k: "name", name: "Long" } },
      { name: "label", type: { k: "name", name: "String" } },
    ]);
    expect(fieldOf(m, "E", "A")).toMatchObject({ k: "call", fn: { k: "qname", path: ["a", "E"] }, args: [{ value: { k: "str", v: "/a" } }] });
  });

});

describe("java lowering: annotations", () => {
  it("keeps the annotations of interfaces, methods and parameters, and nested classes by their qualified name", async () => {
    const m = await lower(
      [
        "package a;",
        '@FeignClient(name = "x", url = "${x.url}")',
        "interface Api {",
        '  String KEY = "k";',
        '  @GET("users/{id}") Call<User> user(@Path("id") String id, @Query("q") String... q);',
        '  @RequestMapping(method = RequestMethod.POST, value = {"/a", "/b"}) void post(@RequestBody Body b);',
        "  record Body(String text) {}",
        "}",
      ].join("\n"),
    );
    const api = m.classes.get("Api")!;
    expect(api.classAnnotations?.[0]).toMatchObject({ type: { k: "name", name: "FeignClient" }, args: [{ name: "name" }, { name: "url", value: { k: "str", v: "${x.url}" } }] });
    expect(fieldOf(m, "Api", "KEY")).toEqual({ k: "str", v: "k" });
    const user = api.methods.get("user")!;
    expect(user.annotations?.[0]).toMatchObject({ type: { k: "name", name: "GET" }, args: [{ value: { k: "str", v: "users/{id}" } }] });
    expect(user.params.map((p) => [p.name, p.kind, p.annotations?.[0]?.args[0]?.value])).toEqual([
      ["id", "normal", { k: "str", v: "id" }],
      ["q", "varargs", { k: "str", v: "q" }],
    ]);
    const post = api.methods.get("post")!;
    expect(post.annotations?.[0]?.args).toMatchObject([{ name: "method", value: { k: "attr", name: "POST" } }, { name: "value", value: { k: "list" } }]);
    expect(post.params[0]!.type).toMatchObject({ k: "qname", path: ["a", "Api", "Body"] });
    expect(m.classes.get("Api.Body")?.qname).toBe("a.Api.Body");
  });

});

describe("java lowering: expressions and types", () => {
  it("reads lambdas, anonymous classes, bean setters, resources, switch values and class literals", async () => {
    const m = await lower(
      [
        "class L {",
        "  Object run(HttpHeaders h, int k) throws Exception {",
        "    Interceptor i = chain -> chain.proceed(chain.request());",
        "    Interceptor j = new Interceptor() { public Response intercept(Chain c) { return c.proceed(c.request()); } };",
        "    HttpHeaders headers = new HttpHeaders();",
        "    headers.setContentType(MediaType.APPLICATION_JSON);",
        "    try (OutputStream os = conn.getOutputStream()) { os.write(b); }",
        '    String path = switch (k) { case 1 -> "/one"; default -> { yield "/other"; } };',
        "    Api api = retrofit.create(Api.class);",
        "    return api;",
        "  }",
        "}",
      ].join("\n"),
    );
    const run = m.classes.get("L")!.methods.get("run")!;
    const value = (name: string): Expr | undefined => run.assigns.find((a) => a.target === name)?.value;
    expect(value("i")).toMatchObject({ k: "fnref", fn: { name: "lambda", params: [{ name: "chain" }] } });
    expect(value("j")).toMatchObject({ k: "fnref", fn: { name: "intercept", params: [{ name: "c" }] } });
    expect(value("headers.contentType")).toMatchObject({ k: "attr", name: "APPLICATION_JSON" });
    expect(value("os")).toMatchObject({ k: "call", fn: { k: "attr", name: "getOutputStream" } });
    expect(value("path")).toEqual({ k: "cond", then: { k: "str", v: "/one" }, else: { k: "str", v: "/other" } });
    expect(value("api")).toMatchObject({ k: "call", args: [{ value: { k: "name", name: "Api" } }] });
    expect(run.returns).toMatchObject([{ k: "name", name: "api" }]);
  });

  it("skips nothing it cannot read: generics, wildcards, annotations of types and module files lower without error", async () => {
    const m = await lower(
      [
        "package a;",
        "@SuppressWarnings({\"unchecked\"})",
        "public sealed class G<T extends Comparable<? super T>> permits H {",
        "  private final Map<String, List<@NonNull T>>[] table = null;",
        "  <R> R map(Function<? super T, ? extends R> f) { return f.apply(null); }",
        "}",
        "final class H extends G<String> {}",
      ].join("\n"),
    );
    expect(m.classes.get("G")!.fieldTypes.get("table")).toMatchObject({ k: "index", obj: { k: "name", name: "Array" } });
    expect(m.classes.get("H")!.bases).toMatchObject([{ k: "index", obj: { k: "name", name: "G" } }]);
  });
});

describe("java lowering: grammar gaps, binary data and generated code", () => {
  it("repairs annotated varargs types (JSpecify) the grammar does not parse, keeping every position", async () => {
    const code = 'class V {\n  String[] of(String @Nullable ... items) { return items; }\n  void run(Object @org.jspecify.annotations.Nullable... rest) { client.get("https://x"); }\n}\n';
    const fixed = varargsAnnotations(code);
    expect(fixed).toHaveLength(code.length);
    expect(fixed).toContain("String           ... items");
    const parser = await parserFor("java");
    const [before, after] = [code, fixed].map((c) => parser.parse(c)!);
    try {
      expect(syntaxError(before!)).toBeDefined();
      expect(syntaxError(after!)).toBeUndefined();
    } finally {
      before!.delete();
      after!.delete();
      parser.delete();
    }
  });

  it("reads array initializers as lists, but not byte arrays (binary data)", async () => {
    const m = await lower('class Arr {\n  static final String[] S = new String[] {"a", "b"};\n  static final byte[] B = new byte[] {0x78, 0};\n}\n');
    expect(fieldOf(m, "Arr", "S")).toEqual({ k: "list", items: [{ k: "str", v: "a" }, { k: "str", v: "b" }] });
    expect(fieldOf(m, "Arr", "B")).toMatchObject({ k: "unknown" });
  });

  it("lowers operator chains thousands deep (generated code) without running out of stack", async () => {
    const terms = Array.from({ length: 20000 }, (_, i) => `"p${i}"`);
    const m = await lower(`class Big {\n  static final String S = ${terms.join(" + ")} + (BASE + "/x");\n  static final boolean B = ${Array(20000).fill("a == 1").join(" && ")};\n}\n`);
    const s = fieldOf(m, "Big", "S");
    expect(s).toMatchObject({ k: "concat" });
    const parts = s?.k === "concat" ? s.parts : [];
    expect(parts).toHaveLength(20001);
    expect(parts[0]).toEqual({ k: "str", v: "p0" });
    expect(parts[20000]).toMatchObject({ k: "concat", parts: [{ k: "name", name: "BASE" }, { k: "str", v: "/x" }] });
    expect(fieldOf(m, "Big", "B")).toMatchObject({ k: "unknown" });
  });
});
