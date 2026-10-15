import { describe, expect, it } from "vitest";
import { HostLiterals } from "../../src/hosts/literals.js";
import { collectHostLiterals as irLiterals } from "../../src/lang/ir/host-literals.js";
import { rustTestCode } from "../../src/lang/rust/lower.js";
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
  irLiterals(tree.rootNode, language, "f", lit, language === "rust" ? rustTestCode(tree.rootNode) : []);
  tree.delete();
  parser.delete();
  return seen(lit);
}

describe("typescript literals that are no call", () => {
  it("typescript: logs, errors, redirects, links and in-source tests are left out; a call inside a log is not", () => {
    const sf = sourceOf(
      [
        'console.log(chalk.green(`Open https://api.log.com/v1/${x}`));',
        'logger.info("see https://api.log.com/v2");',
        'throw new Error("create a key at https://api.log.com/v3/keys");',
        'res.redirect("https://api.log.com/v1/consent");',
        'const BOTS = [{ name: "Slackbot", url: "https://api.bots.com/v1/robots-info/help" }, { name: "x", homepage: "https://api.home.com/v1" }];',
        'const el = <a href="https://api.jsx.com/v1">x</a>;',
        'options.authorizationURL = options.authorizationURL || "https://api.auth.com/v1/consent";',
        'const DOCS_URL = "https://api.docs-site.com/v1";',
        'console.log(await fetch("https://api.real.com/v1/a"));',
        'const req = { url: "https://api.req.com/v1/help/x", method: "POST" };',
        'if (import.meta.vitest) { const t = "https://api.test.com/v1"; }',
      ].join("\n"),
      "/repo/a.tsx",
    );
    const lit = new HostLiterals();
    tsLiterals(sf, "/repo", lit);
    expect(seen(lit)).toEqual(["api.real.com:9", "api.req.com:10"]);
  });

});

describe("tree-sitter literals that are no call", () => {
  it("python: print, logging, f-strings in them, a docs url and a link key", async () => {
    const code = [
      'print(f"Open https://api.log.com/v1/{x}")',
      'logger.warning("see {}".format("https://api.log.com/v2"))',
      'raise ValueError("bad https://api.log.com/v3")',
      'BOTS = [{"name": "Slackbot", "url": "https://api.bots.com/robots"}, {"name": "x", "homepage": "https://api.home.com/v1"}]',
      'requests.get("https://api.real.com/v1", headers={"x": "1"})',
      'print(requests.get("https://api.real2.com/v1"))',
      'f(docs="https://api.kw.com/v1", url="https://api.kwurl.com/v1/help")',
      "",
    ].join("\n");
    expect(await irHosts("python", "python", code)).toEqual(["api.kwurl.com:7", "api.real.com:5", "api.real2.com:6"]);
  });

  it("php: echo, Log::info, $this->info, an exception and a placeholder default", async () => {
    const code = [
      "<?php",
      'echo "Open https://api.log.com/v1";',
      'Log::info("see https://api.log.com/v2");',
      '$this->info("see https://api.log.com/v3");',
      'throw new Exception("see https://api.log.com/v4");',
      "$q = ['prefix' => env('SQS_PREFIX', 'https://sqs.us-east-1.amazonaws.com/your-account-id')];",
      "$c = ['base_uri' => 'https://api.real.com/v1', 'website' => 'https://api.home.com/v1'];",
      "",
    ].join("\n");
    expect(await irHosts("php", "php", code)).toEqual(["api.real.com:7"]);
  });

  it("kotlin, java and go: printing and logging calls", async () => {
    expect(await irHosts("kotlin", "kotlin", 'fun f() {\n println("see https://api.log.com/v1")\n Log.d("T", "https://api.log.com/v2")\n get("https://api.real.com/v1")\n}\n')).toEqual([
      "api.real.com:4",
    ]);
    const java = 'class A { void f() {\n System.out.println("https://api.log.com/v1");\n log.info("https://api.log.com/v2");\n client.get("https://api.real.com/v1");\n} }\n';
    expect(await irHosts("java", "java", java)).toEqual(["api.real.com:4"]);
    const go = 'package a\nfunc f() {\n fmt.Printf("see %s", "https://api.log.com/v1")\n log.Println("https://api.log.com/v2")\n http.Get("https://api.real.com/v1")\n}\n';
    expect(await irHosts("go", "go", go)).toEqual(["api.real.com:5"]);
  });

});

describe("rust test code", () => {
  it("rust: println!, log macros and test code are left out", async () => {
    const code = [
      "fn main() {",
      '    println!("see {}", "https://api.log.com/v1");',
      '    log::info!("https://api.log.com/v2");',
      '    reqwest::get("https://api.real.com/v1".to_string());',
      "}",
      "#[cfg(test)]",
      "mod tests {",
      '    const U: &str = "https://api.test.com/v1";',
      "}",
      "#[tokio::test]",
      'async fn t() { reqwest::get("https://api.test2.com/v1"); }',
      'const BASE: &str = "https://api.real2.com/v1";',
      "",
    ].join("\n");
    expect(await irHosts("rust", "rust", code)).toEqual(["api.real.com:4", "api.real2.com:12"]);
  });
});
