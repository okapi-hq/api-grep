import { describe, expect, it } from "vitest";
import type { Expr, ModuleModel } from "../../src/lang/ir/model.js";
import { lowerPython, moduleName } from "../../src/lang/python/lower.js";
import { parserFor } from "../../src/lang/tree-sitter.js";

async function lower(code: string, file = "/repo/app/services/billing.py"): Promise<ModuleModel> {
  const parser = await parserFor("python");
  const tree = parser.parse(code)!;
  try {
    return lowerPython(tree.rootNode, file, "/repo");
  } finally {
    tree.delete();
    parser.delete();
  }
}

const valueOf = (m: ModuleModel, name: string): Expr | undefined => m.top.assigns.find((a) => a.target === name)?.value;

describe("python lowering", () => {
  it("names modules after their path; a package is its __init__", () => {
    expect(moduleName("/repo/app/services/billing.py", "/repo")).toEqual({ name: "app.services.billing", isPackage: false });
    expect(moduleName("/repo/app/__init__.py", "/repo")).toEqual({ name: "app", isPackage: true });
  });

  it("resolves relative imports against the module's package", async () => {
    const m = await lower("from .config import BASE as B\nfrom ..utils import http\nimport google.genai as genai\nimport os.path\n");
    expect(m.imports.get("B")?.path).toEqual(["app", "services", "config", "BASE"]);
    expect(m.imports.get("http")?.path).toEqual(["app", "utils", "http"]);
    expect(m.imports.get("genai")?.path).toEqual(["google", "genai"]);
    expect(m.imports.get("os")?.path).toEqual(["os"]);
  });

  it("reads string prefixes, escapes, f-strings and env reads", async () => {
    const m = await lower('a = "x\\ty"\nb = r"x\\ty"\nc = f"{base}/{{id}}"\nd = os.getenv("API", "https://x")\ne = os.environ["KEY"]\n');
    expect(valueOf(m, "a")).toEqual({ k: "str", v: "x\ty" });
    expect(valueOf(m, "b")).toEqual({ k: "str", v: "x\\ty" });
    expect(valueOf(m, "c")).toMatchObject({ k: "tmpl", parts: [{ k: "name", name: "base" }, { k: "str", v: "/{id}" }] });
    expect(valueOf(m, "d")).toEqual({ k: "env", name: "API", fallback: { k: "str", v: "https://x" } });
    expect(valueOf(m, "e")).toEqual({ k: "env", name: "KEY" });
  });

  it("drops a method's receiver from its parameters and records its fields", async () => {
    const m = await lower("class Api:\n    base: str = 'https://x'\n    def __init__(self, token: str):\n        self.token = token\n    @staticmethod\n    def ping(url):\n        pass\n");
    const cls = m.classes.get("Api")!;
    expect(cls.methods.get("__init__")!.params.map((p) => p.name)).toEqual(["token"]);
    expect(cls.methods.get("ping")!.params.map((p) => p.name)).toEqual(["url"]);
    expect([...cls.fields.keys()]).toEqual(["base", "token"]);
    expect(cls.annotations).toMatchObject([{ name: "base", optional: true }]);
  });
});
