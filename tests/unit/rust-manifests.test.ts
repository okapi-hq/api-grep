import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cargoManifests, normalizeCrate, parseCargoToml } from "../../src/lang/rust/manifests.js";
import { crateName } from "../../src/lang/rust/names.js";

const CARGO_TOML = `[package]
name = "relay-bot"
version = "0.1.0"

[dependencies]
reqwest = { version = "0.12.9", features = ["json"] }
async_openai = "0.28"
tg = { package = "teloxide", version = "0.13" }
local-lib = { path = "../lib" }

[target.'cfg(unix)'.dependencies]
serenity = "0.12"

[dev-dependencies]
wiremock = "0.6"

[build-dependencies]
cc = "1"
`;

describe("cargo manifests", () => {
  it("reads [dependencies] and per-target dependencies with versions; dev and build dependencies aside", () => {
    expect([...parseCargoToml(CARGO_TOML)]).toEqual([
      ["reqwest", "0.12.9"],
      ["async-openai", "0.28"],
      ["teloxide", "0.13"],
      ["local-lib", ""],
      ["serenity", "0.12"],
    ]);
    expect(parseCargoToml("not = [toml")).toEqual(new Map());
  });

  it("reads a member's `x.workspace = true` against the workspace's [workspace.dependencies]", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-grep-cargo-"));
    mkdirSync(path.join(dir, "crates", "bot", "src"), { recursive: true });
    writeFileSync(path.join(dir, "Cargo.toml"), '[workspace]\nmembers = ["crates/*"]\n\n[workspace.dependencies]\nasync-openai = "0.28.3"\n');
    writeFileSync(path.join(dir, "crates", "bot", "Cargo.toml"), '[package]\nname = "bot"\n\n[dependencies]\nasync-openai.workspace = true\nureq = "2"\n');
    const m = cargoManifests();
    const file = path.join(dir, "crates", "bot", "src", "main.rs");
    expect(m.version(file, "async-openai", dir)).toBe("0.28.3");
    expect(m.version(file, "async_openai", dir)).toBe("0.28.3");
    expect([...m.declared(new Set([path.join(dir, "crates", "bot")]), dir)]).toEqual(["async-openai", "ureq"]);
  });

  it("normalizes crate names and reads the crate name the code uses", () => {
    expect(normalizeCrate("Async_OpenAI")).toBe("async-openai");
    expect(crateName('[package]\nname = "relay-bot"\n')).toBe("relay_bot");
    expect(crateName('[package]\nname = "relay-bot"\n[lib]\nname = "relay"\n')).toBe("relay");
    expect(crateName("[workspace]\nmembers = []\n")).toBeUndefined();
  });
});
