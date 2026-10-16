import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { linkDart } from "../../src/lang/dart/link.js";
import { lowerDart } from "../../src/lang/dart/lower.js";
import { dartModulePath, importTarget } from "../../src/lang/dart/names.js";
import type { Expr, FunctionDef, ModuleModel } from "../../src/lang/ir/model.js";
import { parserFor, syntaxError } from "../../src/lang/tree-sitter.js";

/** A package `harbor_app` with its libraries under `lib/`. */
function packageDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "api-grep-dart-"));
  mkdirSync(path.join(dir, "lib", "api"), { recursive: true });
  writeFileSync(path.join(dir, "pubspec.yaml"), "name: harbor_app\ndependencies:\n  http: ^1.2.0\n");
  return dir;
}

const DIR = packageDir();

async function lower(code: string, rel = "lib/api/client.dart"): Promise<ModuleModel> {
  const parser = await parserFor("dart");
  const tree = parser.parse(code)!;
  try {
    expect(syntaxError(tree)).toBeUndefined();
    return lowerDart(tree.rootNode, path.join(DIR, rel), DIR);
  } finally {
    tree.delete();
    parser.delete();
  }
}

const valueOf = (fn: FunctionDef, name: string): Expr | undefined => fn.assigns.find((a) => a.target === name)?.value;

describe("dart lowering: libraries and imports", () => {
  it("names a library after its package and its path under lib/", () => {
    expect(dartModulePath(path.join(DIR, "lib", "main.dart"), DIR)).toEqual(["harbor_app", "main"]);
    expect(dartModulePath(path.join(DIR, "lib", "api", "client.dart"), DIR)).toEqual(["harbor_app", "api", "client"]);
    expect(dartModulePath(path.join(DIR, "bin", "sync.dart"), DIR)).toEqual(["harbor_app", "@bin", "sync"]);
    const from = path.join(DIR, "lib", "api", "client.dart");
    expect(importTarget("package:harbor_app/api/models.dart", from, DIR)).toEqual(["harbor_app", "api", "models"]);
    expect(importTarget("../config.dart", from, DIR)).toEqual(["harbor_app", "config"]);
    expect(importTarget("dart:convert", from, DIR)).toEqual(["dart", "convert"]);
    expect(importTarget("package:dio/dio.dart", from, DIR)).toEqual(["dio", "dio"]);
    expect(importTarget("../../../outside.dart", from, DIR)).toBeUndefined();
  });

  it("reads prefixed imports as names, the others as libraries link.ts opens", async () => {
    const client = await lower("import 'package:http/http.dart' as http;\nimport '../config.dart' show baseUrl;\nimport 'package:dio/dio.dart';\nexport 'models.dart';\n");
    const config = await lower("const baseUrl = 'https://api.harbor.example';\nconst other = 1;\n", "lib/config.dart");
    const models = await lower("class Boat {}\n", "lib/api/models.dart");
    linkDart([client, config, models]);
    expect([...client.imports].map(([k, v]) => [k, v.path.join(".")])).toEqual([
      ["http", "http"],
      ["baseUrl", "harbor_app.config.baseUrl"],
    ]);
    // a package outside the project is named by its package; its classes are found through `wildcardTypes`
    expect(client.wildcards).toEqual([["dio"]]);
    expect(client.importPaths).toEqual([["http"], ["harbor_app", "config"], ["dio"]]);
  });
});

describe("dart lowering: literals", () => {
  it("reads strings: interpolation, adjacent strings, raw and multi-line strings, escapes", async () => {
    const m = await lower(
      "final a = 'https://api.harbor.example/v1/boats/$id';\nfinal b = \"${cfg.base}/x\";\nfinal c = 'https://a.example' '/v2';\nfinal d = r'raw\\n$x';\nfinal e = '''multi\nline''';\nfinal f = 'tab\\t\\u0041\\$';\n",
    );
    expect(valueOf(m.top, "a")).toMatchObject({ k: "tmpl", parts: [{ k: "str", v: "https://api.harbor.example/v1/boats/" }, { k: "name", name: "id" }] });
    expect(valueOf(m.top, "b")).toMatchObject({ k: "tmpl", parts: [{ k: "attr", name: "base", obj: { k: "name", name: "cfg" } }, { k: "str", v: "/x" }] });
    expect(valueOf(m.top, "c")).toEqual({ k: "str", v: "https://a.example/v2" });
    expect(valueOf(m.top, "d")).toEqual({ k: "str", v: "raw\\n$x" });
    expect(valueOf(m.top, "e")).toEqual({ k: "str", v: "multi\nline" });
    expect(valueOf(m.top, "f")).toEqual({ k: "str", v: "tab\tA$" });
  });

  it("reads environment reads, Uri.parse, maps with conditional keys and spreads, concatenation and ??", async () => {
    const m = await lower(
      "final a = String.fromEnvironment('API_URL', defaultValue: 'https://d.example');\nfinal b = dotenv.env['KEY'] ?? 'k';\nfinal c = Platform.environment['HOME'];\nfinal d = Uri.parse(base + '/x');\nfinal e = {'a': 1, if (x) 'b': 2, ...rest};\nfinal f = dotenv.get('TOKEN', fallback: 't');\n",
    );
    expect(valueOf(m.top, "a")).toEqual({ k: "env", name: "API_URL", fallback: { k: "str", v: "https://d.example" } });
    expect(valueOf(m.top, "b")).toEqual({ k: "or", left: { k: "env", name: "KEY" }, right: { k: "str", v: "k" } });
    expect(valueOf(m.top, "c")).toEqual({ k: "env", name: "HOME" });
    expect(valueOf(m.top, "d")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/x" }] });
    const e = valueOf(m.top, "e") as Extract<Expr, { k: "dict" }>;
    expect(e.entries.map((en) => [en.key?.k === "str" ? en.key.v : null, !!en.optional, !!en.spread])).toEqual([
      ["a", false, false],
      ["b", true, false],
      [null, false, true],
    ]);
    expect(valueOf(m.top, "f")).toEqual({ k: "env", name: "TOKEN", fallback: { k: "str", v: "t" } });
  });

});

describe("dart lowering: classes and assignments", () => {
  it("reads classes: constructors, initializer lists, fields, getters, named constructors and implicit this", async () => {
    const m = await lower(
      "class Api extends Base {\n  Api(this.token, {String? host}) : base = host ?? 'https://h.example';\n  Api.staging() : base = 'https://s.example', token = '';\n  final String token;\n  final String base;\n  static const version = 'v2';\n  String get root => '$base/$version';\n  Future<void> ping() async { final url = '$root/ping'; await http.get(Uri.parse(url)); }\n}\n",
    );
    const api = m.classes.get("Api")!;
    expect(api.qname).toBe("harbor_app.api.client.Api");
    expect(api.bases).toMatchObject([{ k: "name", name: "Base" }]);
    expect(api.methods.get("<init>")!.params.map((p) => p.name)).toEqual(["token", "host"]);
    expect(api.fields.get("token")!.map((f) => f.value)).toMatchObject([{ k: "name", name: "token" }, { k: "str", v: "" }]);
    expect(api.fields.get("base")!.map((f) => f.value.k)).toEqual(["or", "str"]);
    expect(api.methods.get("staging")).toMatchObject({ isStatic: true, returns: [{ k: "call", fn: { k: "name", name: "Api" } }] });
    expect(api.methods.get("root")).toMatchObject({ isProperty: true });
    // a member read without `this.`
    const ping = api.methods.get("ping")!;
    expect(valueOf(ping, "url")).toMatchObject({ k: "tmpl", parts: [{ k: "attr", obj: { k: "this" }, name: "root" }, { k: "str", v: "/ping" }] });
    expect(ping.calls.map((c) => (c.fn.k === "attr" ? c.fn.name : c.fn.k))).toEqual(["get"]);
  });

  it("reads assignments: locals, fields, attributes and keys set on locals, cascades", async () => {
    const m = await lower(
      "class S {\n  String? token;\n  void f(String t) {\n    final headers = <String, String>{};\n    headers['Authorization'] = 'Bearer $t';\n    token = t;\n    final req = Req()..method = 'POST';\n    req.body = '{}';\n    req.headers['X'] = 'y';\n  }\n}\n",
    );
    const f = m.classes.get("S")!.methods.get("f")!;
    expect(f.assigns.find((a) => a.edit === "merge")).toMatchObject({ target: "headers", value: { k: "dict" } });
    expect(m.classes.get("S")!.fields.get("token")).toMatchObject([{ value: { k: "name", name: "t" } }]);
    expect(f.attrSets?.map((s) => [s.target, s.name])).toEqual([
      ["req", "body"],
      ["req", "headers"],
    ]);
    expect(f.calls.map((c) => (c.fn.k === "name" ? c.fn.name : "?"))).toEqual(["Req"]);
  });
});
