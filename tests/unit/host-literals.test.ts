import { describe, expect, it } from "vitest";
import { HostLiterals } from "../../src/hosts/literals.js";
import { collectHostLiterals as irLiterals } from "../../src/lang/ir/host-literals.js";
import { parserFor } from "../../src/lang/tree-sitter.js";
import { collectHostLiterals as tsLiterals } from "../../src/lang/typescript/host-literals.js";
import type { Language } from "../../src/report/schema.js";
import { sourceOf } from "../helpers.js";

/** Named hosts and their first line. */
const seen = (lit: HostLiterals): string[] => [...lit.seen].map(([h, s]) => `${h}:${s.first.line}`).sort();

async function irHosts(grammar: string, language: Language, code: string): Promise<string[]> {
  const parser = await parserFor(grammar);
  const tree = parser.parse(code)!;
  const lit = new HostLiterals();
  irLiterals(tree.rootNode, language, "f", lit);
  tree.delete();
  parser.delete();
  return seen(lit);
}

describe("string literals of each front end", () => {
  it("typescript: strings and templates, not comments or module specifiers", () => {
    const sf = sourceOf(
      [
        'import x from "https://api.esm-mirror.com/v1/x";',
        "// https://api.commented.com/v1",
        'const a = "https://api.one.com";',
        "const b = `https://api.two.com/v1/${a}`;",
        "const c = `https://${a}.api.three.com/v1`;",
        'const d = `prefix ${"https://api.four.com"} suffix`;',
      ].join("\n"),
      "/repo/a.ts",
    );
    const lit = new HostLiterals();
    tsLiterals(sf, "/repo", lit);
    expect(seen(lit)).toEqual(["api.four.com:6", "api.one.com:3", "api.two.com:4"]);
    expect(lit.seen.get("api.one.com")).toMatchObject({ language: "typescript", first: { file: "a.ts" } });
  });

  it("python: f-strings, not docstrings or comments", async () => {
    const code = ['"""Module doc: https://api.doc.com/v1"""', "# https://api.comment.com", 'A = f"https://api.one.com/v1/{x}"', 'B = ("https://api.two.com"', '     "/v1")', ""].join("\n");
    expect(await irHosts("python", "python", code)).toEqual(["api.one.com:3", "api.two.com:4"]);
  });

  it("php: single, double quoted and heredoc strings", async () => {
    const code = ["<?php", "// https://api.comment.com", "$a = 'https://api.one.com';", '$b = "https://api.two.com/v1/{$id}";', "$c = <<<EOT", "https://api.three.com/v2", "EOT;", ""].join("\n");
    expect(await irHosts("php", "php", code)).toEqual(["api.one.com:3", "api.three.com:6", "api.two.com:4"]);
  });

  it("kotlin, java and go", async () => {
    expect(await irHosts("kotlin", "kotlin", 'val a = "https://api.one.com/${v}"\n// https://api.comment.com\nval b = """\nhttps://api.two.com\n"""\n')).toEqual([
      "api.one.com:1",
      "api.two.com:4",
    ]);
    expect(await irHosts("java", "java", 'class A { /* https://api.comment.com */ String a = "https://api.one.com/v1"; }\n')).toEqual(["api.one.com:1"]);
    expect(await irHosts("go", "go", 'package a\n// https://api.comment.com\nvar a = "https://api.one.com"\nvar b = `https://api.two.com`\n')).toEqual([
      "api.one.com:3",
      "api.two.com:4",
    ]);
  });
});
