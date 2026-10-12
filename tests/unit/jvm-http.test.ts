import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/lang/ir/evaluate.js";
import type { CallExpr, FunctionDef, ModuleModel } from "../../src/lang/ir/model.js";
import { ProjectIndex } from "../../src/lang/ir/project.js";
import { withSelf, withSubst, type IrCtx } from "../../src/lang/ir/raw.js";
import { shapeOf } from "../../src/lang/ir/shape.js";
import { dictOf, staticKey } from "../../src/lang/ir/values.js";
import { okHttpClientFacts } from "../../src/lang/jvm/http/okhttp.js";
import { kotlinLanguage } from "../../src/lang/kotlin/index.js";
import { lowerKotlin } from "../../src/lang/kotlin/lower.js";
import { parserFor } from "../../src/lang/tree-sitter.js";
import { partsToTemplate } from "../../src/resolve/parts.js";

async function lower(code: string): Promise<ModuleModel> {
  const parser = await parserFor("kotlin");
  const tree = parser.parse(code)!;
  try {
    return lowerKotlin(tree.rootNode, "/repo/src/main/kotlin/Api.kt", "/repo");
  } finally {
    tree.delete();
    parser.delete();
  }
}

async function ctxOf(code: string): Promise<{ mod: ModuleModel; ctx: IrCtx }> {
  const mod = await lower(code);
  return { mod, ctx: { idx: new ProjectIndex(kotlinLanguage, [mod]) } };
}

const fnNamed = (mod: ModuleModel, name: string): FunctionDef => mod.allFunctions.find((f) => f.name === name)!;
const callNamed = (fn: FunctionDef, name: string): CallExpr => fn.calls.find((c) => c.fn.k === "attr" && c.fn.name === name)!;

describe("kotlin lowering for HTTP clients", () => {
  it("keeps property sets on local objects, class annotations, and single-function objects as functions", async () => {
    const mod = await lower(
      'fun f() {\n  val conn = open()\n  conn.requestMethod = "POST"\n  val i = object : Interceptor { override fun intercept(chain: Chain) = chain.proceed(chain.request()) }\n}\n@FeignClient(url = "https://x")\ninterface Api\n',
    );
    const f = fnNamed(mod, "f");
    expect(f.assigns.find((a) => a.target === "conn.requestMethod")?.value).toEqual({ k: "str", v: "POST" });
    expect(f.assigns.find((a) => a.target === "i")?.value).toMatchObject({ k: "fnref", fn: { name: "intercept" } });
    expect(mod.classes.get("Api")?.classAnnotations).toMatchObject([{ type: { k: "name", name: "FeignClient" }, args: [{ name: "url", value: { k: "str", v: "https://x" } }] }]);
  });
});

describe("values built entry by entry", () => {
  it("reads JSONObject chains, JSONArray items and maps built on a variable", async () => {
    const { mod, ctx } = await ctxOf(
      'fun f(id: String) {\n  val a = JSONObject().put("method", "get").put("params", JSONArray().put(id)).toString()\n  val o = JSONObject()\n  o.put("limit", 10)\n  o.put("q", id)\n  send(o)\n}\n',
    );
    const f = fnNamed(mod, "f");
    const a = f.assigns.find((x) => x.target === "a")!.value;
    expect(shapeOf(a, f, ctx).shape).toEqual({
      type: "object",
      properties: { method: { type: "string", enum: ["get"] }, params: { type: "array", items: { type: "string", hint: "id" } } },
      required: ["method", "params"],
    });
    const sent = f.calls.find((c) => c.fn.k === "name" && c.fn.name === "send")!.args[0]!.value;
    const dict = dictOf(sent, f, ctx)!;
    expect(dict.entries.map((e) => staticKey(e.key, dict.fn, ctx))).toEqual(["limit", "q"]);
  });

  it("reads Spring HttpHeaders with their auth helpers, properties and library constants", async () => {
    const { mod, ctx } = await ctxOf(
      "fun f(token: String) {\n  val h = HttpHeaders()\n  h.setBearerAuth(token)\n  h.set(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)\n  h.contentType = MediaType.APPLICATION_JSON\n  use(h)\n}\n",
    );
    const f = fnNamed(mod, "f");
    const used = f.calls.find((c) => c.fn.k === "name" && c.fn.name === "use")!.args[0]!.value;
    const dict = dictOf(used, f, ctx)!;
    const entries = dict.entries.map((e) => [staticKey(e.key, dict.fn, ctx), partsToTemplate(evaluate(e.value, dict.fn, ctx))]);
    expect(entries).toEqual([
      ["Authorization", "Bearer {token}"],
      ["Accept", "application/json"],
      ["Content-Type", "application/json"],
    ]);
  });
});

describe("OkHttp client facts", () => {
  it("gives the interceptor pairs of a client passed elsewhere, as a Retrofit builder's `.client(...)` does", async () => {
    const { mod, ctx } = await ctxOf(
      [
        "class KeyInterceptor(private val key: String) : Interceptor {",
        "  override fun intercept(chain: Interceptor.Chain): Response =",
        '    chain.proceed(chain.request().newBuilder().url(chain.request().url.newBuilder().addQueryParameter("api_key", key).build()).build())',
        "}",
        "object Movies {",
        '  private val http = OkHttpClient.Builder().addInterceptor(KeyInterceptor(System.getenv("TMDB_KEY"))).addInterceptor { it.proceed(it.request().newBuilder().header("Accept", "application/json").build()) }.build()',
        '  val api = Retrofit.Builder().baseUrl("https://api.themoviedb.org/3/").client(http).build()',
        "}",
      ].join("\n"),
    );
    const init = mod.classes.get("Movies")!.methods.get("<init>")!;
    const client = callNamed(init, "client");
    const pairs = okHttpClientFacts({ expr: client.args[0]!.value, fn: init }, ctx);
    const read = pairs.map((p) => {
      const at = withSelf(withSubst(ctx, p.subst), p.self);
      return [p.where, staticKey(p.name.expr, p.name.fn, at), partsToTemplate(evaluate(p.value!.expr, p.value!.fn, at)), p.from];
    });
    expect(read).toEqual([
      ["query", "api_key", "{env:TMDB_KEY}", "interceptor"],
      ["header", "Accept", "application/json", "interceptor"],
    ]);
  });
});
