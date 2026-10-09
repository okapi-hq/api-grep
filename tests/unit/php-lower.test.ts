import { describe, expect, it } from "vitest";
import type { Expr, ModuleModel } from "../../src/lang/ir/model.js";
import { lowerPhp } from "../../src/lang/php/lower.js";
import { parserFor } from "../../src/lang/tree-sitter.js";

async function lower(code: string): Promise<ModuleModel> {
  const parser = await parserFor("php");
  const tree = parser.parse(code)!;
  try {
    return lowerPhp(tree.rootNode, "/repo/app/Billing.php");
  } finally {
    tree.delete();
    parser.delete();
  }
}

const valueOf = (m: ModuleModel, name: string): Expr | undefined => m.top.assigns.find((a) => a.target === name)?.value;

describe("php lowering", () => {
  it("resolves class names through the namespace and use imports", async () => {
    const m = await lower("<?php\nnamespace App\\Billing;\nuse GuzzleHttp\\Client as Http;\nuse Illuminate\\Support\\Facades\\{Cache, Config as C};\n$a = new Http();\n$b = new Invoice();\n$c = new \\Stripe\\StripeClient('k');\n$d = C::get('x');\n");
    expect(m.name).toBe("App.Billing");
    expect(valueOf(m, "$a")).toMatchObject({ k: "call", isNew: true, fn: { k: "qname", path: ["GuzzleHttp", "Client"] } });
    expect(valueOf(m, "$b")).toMatchObject({ fn: { k: "qname", path: ["App", "Billing", "Invoice"] } });
    expect(valueOf(m, "$c")).toMatchObject({ fn: { k: "qname", path: ["Stripe", "StripeClient"] } });
    expect(valueOf(m, "$d")).toMatchObject({ fn: { k: "attr", name: "get", obj: { k: "qname", path: ["Illuminate", "Support", "Facades", "Config"] } } });
    expect(m.importPaths.map((p) => p.join("."))).toEqual(["GuzzleHttp.Client", "Illuminate.Support.Facades.Cache", "Illuminate.Support.Facades.Config", "App.Billing.Invoice", "Stripe.StripeClient"]);
  });

  it("reads quotes, escapes, interpolation, heredocs and env reads", async () => {
    const m = await lower("<?php\n$a = 'it\\'s $x';\n$b = \"tab\\t{$u->id}/$v\";\n$c = <<<EOT\n  https://x/{$id}\n  EOT;\n$d = getenv('API') ?: 'https://d';\n$e = $_ENV['KEY'];\n$f = env('URL', 'https://f');\n$g = sprintf('%s/x', $b);\n");
    expect(valueOf(m, "$a")).toEqual({ k: "str", v: "it's $x" });
    expect(valueOf(m, "$b")).toMatchObject({ k: "tmpl", parts: [{ k: "str", v: "tab\t" }, { k: "attr", name: "id" }, { k: "str", v: "/" }, { k: "name", name: "$v" }] });
    expect(valueOf(m, "$c")).toMatchObject({ k: "tmpl", parts: [{ k: "str", v: "https://x/" }, { k: "name", name: "$id" }] });
    expect(valueOf(m, "$d")).toMatchObject({ k: "or", left: { k: "env", name: "API" }, right: { k: "str", v: "https://d" } });
    expect(valueOf(m, "$e")).toEqual({ k: "env", name: "KEY" });
    expect(valueOf(m, "$f")).toEqual({ k: "env", name: "URL", fallback: { k: "str", v: "https://f" } });
    expect(valueOf(m, "$g")).toMatchObject({ k: "format", style: "printf" });
  });

  it("records class constants, typed and promoted properties, and constructor assignments", async () => {
    const m = await lower("<?php\nclass Api {\n  const BASE = 'https://x';\n  private Client $http;\n  public function __construct(private StripeClient $stripe, string $url = 'https://y') { $this->url = $url; }\n}\n");
    const cls = m.classes.get("Api")!;
    expect([...cls.fields.keys()]).toEqual(["BASE", "stripe", "url"]);
    expect([...cls.fieldTypes.keys()]).toEqual(["http", "stripe"]);
    expect(cls.methods.get("__construct")!.params.map((p) => p.name)).toEqual(["$stripe", "$url"]);
  });

  it("treats define() and const as module constants and closures as functions", async () => {
    const m = await lower("<?php\ndefine('API', 'https://a');\nconst B = 'https://b';\n$f = fn ($x) => $x;\n$g = function ($y) use ($f) { return $y; };\n");
    expect(valueOf(m, "API")).toEqual({ k: "str", v: "https://a" });
    expect(valueOf(m, "B")).toEqual({ k: "str", v: "https://b" });
    expect(valueOf(m, "$f")).toMatchObject({ k: "fnref", fn: { inherits: ["*"] } });
    expect(valueOf(m, "$g")).toMatchObject({ k: "fnref", fn: { inherits: ["$f"] } });
  });
});
