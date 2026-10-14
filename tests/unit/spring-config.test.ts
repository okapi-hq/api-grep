import { describe, expect, it } from "vitest";
import { parseProperties, parseYaml, relaxedKey } from "../../src/lang/jvm/spring-config.js";

describe("Spring Boot configuration files", () => {
  it("reads nested YAML mappings, quoted values and trailing comments; skips lists, block scalars and profiles", () => {
    const props = parseYaml(
      [
        "spring:",
        "  ai:",
        "    openai:",
        "      base-url: 'https://gateway.example.com'",
        "      chat:",
        "        options:",
        "          model: gpt-4o-mini # the default",
        "      tags:",
        "        - model: not-a-mapping",
        "      prompt: |",
        "        model: inside a block",
        "    ollama.chat.model: \"llama3.2\"",
        "---",
        "spring:",
        "  config:",
        "    activate:",
        "      on-profile: prod",
        "  ai:",
        "    openai:",
        "      chat:",
        "        options:",
        "          model: gpt-4.1",
      ].join("\n"),
    );
    expect(props.get(relaxedKey("spring.ai.openai.chat.options.model"))).toBe("gpt-4o-mini");
    expect(props.get(relaxedKey("spring.ai.openai.baseUrl"))).toBe("https://gateway.example.com");
    expect(props.get(relaxedKey("spring.ai.ollama.chat.model"))).toBe("llama3.2");
    expect([...props.keys()].some((k) => k.includes("tags") || k.includes("prompt"))).toBe(false);
  });

  it("reads properties files, comments aside", () => {
    const props = parseProperties("# spring.ai.openai.chat.options.model=old\n! also a comment\nspring.ai.openai.chat.options.model = ${CHAT_MODEL:gpt-4.1-mini}\nspring.ai.openai.base_url: http://localhost:4000\n");
    expect(props.get(relaxedKey("spring.ai.openai.chat.options.model"))).toBe("${CHAT_MODEL:gpt-4.1-mini}");
    expect(props.get(relaxedKey("spring.ai.openai.base-url"))).toBe("http://localhost:4000");
    expect(props.size).toBe(2);
  });

  it("stays linear on hostile input", () => {
    const line = `k: ${" ".repeat(3_900)}x${" ".repeat(90)}\n`;
    const text = `${"a:\n ".repeat(2_000)}${":".repeat(3_000)}\n${line.repeat(1_000)}${" ".repeat(1_000_000)}`;
    const t = Date.now();
    parseYaml(text);
    parseProperties(text);
    expect(Date.now() - t).toBeLessThan(2000);
  });
});
