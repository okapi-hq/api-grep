import { describe, expect, it } from "vitest";
import { lowerGo } from "../../src/lang/go/lower.js";
import { importSegments, packageName } from "../../src/lang/go/names.js";
import { fieldKey } from "../../src/lang/go/structs.js";
import { jsonTag } from "../../src/lang/go/tags.js";
import type { Expr, ModuleModel } from "../../src/lang/ir/model.js";
import { parserFor } from "../../src/lang/tree-sitter.js";

async function lower(code: string): Promise<ModuleModel> {
  const parser = await parserFor("go");
  const tree = parser.parse(code)!;
  try {
    return lowerGo(tree.rootNode, "/repo/internal/billing/client.go", "/repo");
  } finally {
    tree.delete();
    parser.delete();
  }
}

const valueOf = (m: ModuleModel, name: string, fn = m.top): Expr | undefined => fn.assigns.find((a) => a.target === name)?.value;

describe("go lowering", () => {
  it("reads imports with and without aliases as dotted import roots", async () => {
    const m = await lower('package billing\nimport (\n  "net/http"\n  oai "github.com/sashabaranov/go-openai"\n  "github.com/anthropics/anthropic-sdk-go"\n  _ "embed"\n)\n');
    expect(m.name).toBe("internal.billing");
    expect([...m.imports].map(([alias, ref]) => [alias, ref.path.join(".")])).toEqual([
      ["http", "net.http"],
      ["oai", "github_com.sashabaranov.go-openai"],
      ["anthropic", "github_com.anthropics.anthropic-sdk-go"],
    ]);
    expect(m.importPaths).toHaveLength(4);
  });
});

describe("go lowering: values", () => {
  it("reads constants, variables, strings, env reads, Sprintf, concatenation and joins", async () => {
    const m = await lower(
      'package billing\nimport (\n  "fmt"\n  "os"\n  "path"\n)\nconst (\n  base = "https://api.example.com"\n  raw = `a\\nb`\n)\nvar (\n  key = os.Getenv("API_KEY")\n  tab = "a\\tb"\n  u = fmt.Sprintf("%s/v%d/items", base, 2)\n  c = base + "/v1"\n  j = path.Join(base, "v1")\n)\nvar typed *http.Client\n',
    );
    expect(valueOf(m, "base")).toEqual({ k: "str", v: "https://api.example.com" });
    expect(valueOf(m, "raw")).toEqual({ k: "str", v: "a\\nb" });
    expect(valueOf(m, "tab")).toEqual({ k: "str", v: "a\tb" });
    expect(valueOf(m, "key")).toEqual({ k: "env", name: "API_KEY" });
    expect(valueOf(m, "u")).toMatchObject({ k: "format", style: "printf", template: { k: "str", v: "%s/v%d/items" } });
    expect(valueOf(m, "c")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/v1" }] });
    expect(valueOf(m, "j")).toMatchObject({ k: "concat", parts: [{ k: "name", name: "base" }, { k: "str", v: "/" }, { k: "str", v: "v1" }] });
    expect(m.top.assigns.find((a) => a.target === "typed")).toMatchObject({ type: { k: "attr", name: "Client", obj: { k: "name", name: "http" } } });
  });

  it("lowers struct literals as calls of their type, maps as dicts, slices as lists", async () => {
    const m = await lower(
      'package billing\nfunc f() {\n  req := openai.ChatCompletionRequest{Model: "gpt-4o", Messages: []openai.ChatCompletionMessage{{Role: "user"}}}\n  m := map[string]any{"a": 1}\n  anon := struct {\n    Name string `json:"name"`\n    hidden int\n  }{Name: "x", hidden: 1}\n  c := &http.Client{}\n}\n',
    );
    const fn = m.functions.get("f")!;
    expect(valueOf(m, "req", fn)).toMatchObject({ k: "call", isNew: true, fn: { k: "attr", name: "ChatCompletionRequest" }, args: [{ name: "Model" }, { name: "Messages", value: { k: "list", items: [{ k: "call", isNew: true, fn: { name: "ChatCompletionMessage" } }] } }] });
    expect(valueOf(m, "m", fn)).toEqual({ k: "dict", entries: [{ key: { k: "str", v: "a" }, value: { k: "num", v: 1 } }] });
    expect(valueOf(m, "anon", fn)).toEqual({ k: "dict", entries: [{ key: { k: "str", v: "name" }, value: { k: "str", v: "x" } }] });
    expect(valueOf(m, "c", fn)).toMatchObject({ k: "call", isNew: true, fn: { k: "attr", name: "Client" } });
    // struct literals are values, not calls
    expect(fn.calls).toEqual([]);
  });

});

describe("go lowering: types and functions", () => {
  it("makes methods of their receiver's type, reads the receiver as this and its assignments as fields", async () => {
    const m = await lower(
      'package billing\ntype Client struct {\n  baseURL string `json:"base_url,omitempty"`\n  ai *openai.Client\n  *Base\n  Model string\n}\nfunc (c *Client) Use(u string) {\n  c.baseURL = u\n  c.ai.CreateChatCompletion(ctx, req)\n}\n',
    );
    const cls = m.classes.get("Client")!;
    expect(cls.qname).toBe("internal.billing.Client");
    expect([...cls.fieldTypes.keys()]).toEqual(["baseURL", "ai", "Model"]);
    expect(cls.bases).toMatchObject([{ k: "name", name: "Base" }]);
    expect(cls.annotations.map((a) => [a.name, a.field, a.optional])).toEqual([
      ["base_url", "baseURL", true],
      ["Model", undefined, false],
    ]);
    const use = cls.methods.get("Use")!;
    expect(use.cls).toBe(cls);
    expect([...cls.fields.keys()]).toEqual(["baseURL"]);
    expect(use.calls[0]!.fn).toMatchObject({ k: "attr", name: "CreateChatCompletion", obj: { k: "attr", name: "ai", obj: { k: "this" } } });
  });

  it("keeps the value of a call returning an error, map keys as edits, attributes set on locals, and functional options", async () => {
    const m = await lower(
      'package billing\nimport "github.com/openai/openai-go/option"\nfunc f() (string, error) {\n  resp, err := http.Get(u)\n  body := map[string]any{}\n  body["model"] = "m"\n  cfg := openai.DefaultConfig(k)\n  cfg.BaseURL = "https://x"\n  c := openai.NewClient(option.WithBaseURL("https://y"))\n  if err != nil {\n    return "", err\n  }\n  return resp.Status, nil\n}\n',
    );
    const fn = m.functions.get("f")!;
    expect(valueOf(m, "resp", fn)).toMatchObject({ k: "call", fn: { k: "attr", name: "Get" } });
    expect(fn.assigns.some((a) => a.target === "err")).toBe(false);
    expect(fn.assigns.find((a) => a.edit)).toMatchObject({ target: "body", edit: "merge" });
    expect(fn.attrSets).toMatchObject([{ target: "cfg", name: "BaseURL", value: { k: "str", v: "https://x" } }]);
    expect(valueOf(m, "c", fn)).toMatchObject({ args: [{ name: "WithBaseURL", value: { k: "str", v: "https://y" } }] });
    // the error path's zero value is not a value the function returns
    expect(fn.returns).toMatchObject([{ k: "attr", name: "Status" }]);
  });

  it("lets a local hide an import of the same name", async () => {
    const m = await lower('package billing\nimport (\n  "net/url"\n  "os"\n)\nfunc f(os string) {\n  url := url.PathEscape(os)\n  x := os.Getenv("A")\n}\n');
    const fn = m.functions.get("f")!;
    expect(valueOf(m, "url", fn)).toMatchObject({ k: "name", name: "os" });
    expect(valueOf(m, "x", fn)).toMatchObject({ k: "call", fn: { k: "attr", name: "Getenv" } });
  });
});

describe("go names", () => {
  it("derives import roots and package names from import paths", () => {
    expect(importSegments("github.com/openai/openai-go/v3/option")).toEqual(["github_com", "openai", "openai-go", "v3", "option"]);
    expect(packageName("github.com/sashabaranov/go-openai")).toBe("openai");
    expect(packageName("github.com/openai/openai-go/v3")).toBe("openai");
    expect(packageName("github.com/anthropics/anthropic-sdk-go")).toBe("anthropic");
    expect(packageName("github.com/anthropics/anthropic-sdk-go/vertex")).toBe("vertex");
    expect(packageName("github.com/go-telegram-bot-api/telegram-bot-api/v5")).toBe("tgbotapi");
    expect(packageName("gopkg.in/yaml.v3")).toBe("yaml");
    expect(packageName("resty.dev/v3")).toBe("resty");
    expect(packageName("net/http")).toBe("http");
  });

  it("names struct fields as their JSON", () => {
    expect(fieldKey("MaxTokens", "snake")).toBe("max_tokens");
    expect(fieldKey("ToolCallID", "snake")).toBe("tool_call_id");
    expect(fieldKey("MessageIDs", "snake")).toBe("message_ids");
    expect(fieldKey("FileIDsList", "snake")).toBe("file_ids_list");
    expect(fieldKey("HTTPClient", "snake")).toBe("http_client");
    expect(fieldKey("MaxOutputTokens", "camel")).toBe("maxOutputTokens");
    expect(fieldKey("HTTPOptions", "camel")).toBe("httpOptions");
  });
});

describe("go struct tags", () => {
  it("reads the json tag's name and options", async () => {
    const parser = await parserFor("go");
    const tree = parser.parse('package p\ntype T struct {\n  A int `json:"a,omitempty" yaml:"b"`\n  B int `json:"-"`\n  C int `yaml:"c"`\n  D int `json:",omitempty"`\n}\n')!;
    const tags = tree.rootNode.descendantsOfType("field_declaration").map((d) => jsonTag(d.childForFieldName("tag") ?? undefined));
    expect(tags).toEqual([{ name: "a", omitempty: true, skip: false }, { omitempty: false, skip: true }, undefined, { omitempty: true, skip: false }]);
    tree.delete();
    parser.delete();
  });
});
