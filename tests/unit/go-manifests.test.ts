import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { goManifests, parseGoMod } from "../../src/lang/go/manifests.js";
import { goModuleName } from "../../src/lang/go/names.js";

const GO_MOD = `module github.com/example-org/app

go 1.22

require github.com/sashabaranov/go-openai v1.40.5

require (
	github.com/go-resty/resty/v2 v2.16.2
	"google.golang.org/genai" v1.30.0
	golang.org/x/net v0.30.0 // indirect
	// a comment
)

replace github.com/go-resty/resty/v2 => ../resty
`;

describe("go manifests", () => {
  it("reads the require directives of go.mod, indirect ones aside, with versions", () => {
    expect([...parseGoMod(GO_MOD)]).toEqual([
      ["github.com/sashabaranov/go-openai", "v1.40.5"],
      ["github.com/go-resty/resty/v2", "v2.16.2"],
      ["google.golang.org/genai", "v1.30.0"],
    ]);
  });

  it("declares the modules of the nearest go.mod and gives their versions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-grep-go-"));
    writeFileSync(path.join(dir, "go.mod"), GO_MOD);
    const m = goManifests();
    expect([...m.declared(new Set([dir]), dir)]).toContain("google.golang.org/genai");
    expect(m.version(path.join(dir, "internal", "llm", "a.go"), "github.com/sashabaranov/go-openai", dir)).toBe("v1.40.5");
  });

  it("names a file's package by its import path, from the module path of its go.mod", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-grep-go-"));
    mkdirSync(path.join(dir, "svc", "internal", "llm"), { recursive: true });
    writeFileSync(path.join(dir, "svc", "go.mod"), "module example.com/svc\n");
    expect(goModuleName(path.join(dir, "svc", "internal", "llm", "a.go"), dir)).toBe("example_com.svc.internal.llm");
    expect(goModuleName(path.join(dir, "svc", "main.go"), dir)).toBe("example_com.svc");
    expect(goModuleName(path.join(dir, "tools", "gen.go"), dir)).toBe("tools");
  });
});
