import { describe, expect, it } from "vitest";
import { languageOf } from "../../src/language.js";

describe("languageOf", () => {
  it("reads the language from the extension", () => {
    expect(languageOf("src/a.ts")).toBe("typescript");
    expect(languageOf("app/page.TSX")).toBe("typescript");
    expect(languageOf("lib/b.mjs")).toBe("javascript");
    expect(languageOf("api/client.py")).toBe("python");
    expect(languageOf("src/Http.php")).toBe("php");
    expect(languageOf("app/src/main/java/Api.kt")).toBe("kotlin");
    expect(languageOf("scripts/release.main.kts")).toBe("kotlin");
    expect(languageOf("app/src/main/java/Api.java")).toBe("java");
    expect(languageOf("internal/llm/client.go")).toBe("go");
    expect(languageOf("scripts/deploy.sh")).toBe("shell");
    expect(languageOf("hooks/notify.zsh")).toBe("shell");
    expect(languageOf("src/llm/client.rs")).toBe("rust");
    expect(languageOf("lib/services/api.dart")).toBe("dart");
  });

  it("falls back to typescript, the language the scanner parses", () => {
    expect(languageOf("Makefile")).toBe("typescript");
    expect(languageOf("v1.2/script")).toBe("typescript");
  });
});
