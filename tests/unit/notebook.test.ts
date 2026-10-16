import { describe, expect, it } from "vitest";
import { notebookPython } from "../../src/lang/python/notebook.js";

const cell = (type: string, source: string[]): object => ({ cell_type: type, metadata: {}, source });
const notebook = (cells: object[], language = "python"): string =>
  JSON.stringify({ cells, metadata: { language_info: { name: language } }, nbformat: 4, nbformat_minor: 5 }, null, 1);

describe("notebookPython", () => {
  it("puts each code line on the line of its JSON string, the rest blank", () => {
    const text = notebook([cell("markdown", ["# Title"]), cell("code", ["import requests\n", "requests.get('https://api.example.dev')"])]);
    const read = notebookPython(text)!;
    const lines = read.text.split("\n");
    expect(lines).toHaveLength(text.split("\n").length);
    const at = text.split("\n").findIndex((l) => l.includes("requests.get"));
    expect(lines[at]).toBe("requests.get('https://api.example.dev')");
    expect(lines.filter((l) => l !== "")).toEqual(["import requests", "requests.get('https://api.example.dev')"]);
  });

  it("leaves out shell escapes, line magics and cells of another language", () => {
    const text = notebook([cell("code", ["!pip install httpx\n", "%load_ext autoreload\n", "x = 1"]), cell("code", ["%%bash\n", "curl https://api.example.dev"]), cell("code", ["%%time\n", "y = 2"])]);
    expect(notebookPython(text)!.text.split("\n").filter((l) => l !== "")).toEqual(["x = 1", "y = 2"]);
  });

  it("reads nothing from a kernel of another language", () => {
    expect(notebookPython(notebook([cell("code", ["res <- GET('https://api.example.dev')"])], "R"))!.text.trim()).toBe("");
  });

  it("refuses a layout that would move lines, and what is no notebook", () => {
    expect(notebookPython(JSON.stringify({ cells: [cell("code", ["a = 1\n", "b = 2"])] }))).toBeUndefined();
    expect(notebookPython(notebook([{ cell_type: "code", metadata: {}, source: "a = 1\nb = 2" }]))).toBeUndefined();
    expect(notebookPython("{ not json")).toBeUndefined();
    expect(notebookPython("[]")).toBeUndefined();
  });

  it("leaves out the cell holding a syntax error, once", () => {
    const text = notebook([cell("code", ["a = 1"]), cell("code", ["python -m train \\\n", "  --epochs 3"]), cell("code", ["b = 2"])]);
    const read = notebookPython(text)!;
    const bad = text.split("\n").findIndex((l) => l.includes("--epochs")) + 1;
    const without = read.without!(bad)!;
    expect(without.split("\n").filter((l) => l !== "")).toEqual(["a = 1", "b = 2"]);
    expect(read.without!(1)).toBeUndefined();
  });
});
