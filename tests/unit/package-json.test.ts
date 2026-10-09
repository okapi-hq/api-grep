import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageJsonReader } from "../../src/package-json.js";

function writeJson(dir: string, content: unknown): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), typeof content === "string" ? content : JSON.stringify(content));
}

let root: string;
let app: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "api-grep-pkg-"));
  app = path.join(root, "packages", "app");
  writeJson(root, { dependencies: { stripe: "^14.0.0" }, devDependencies: { vitest: "^4.0.0" } });
  writeJson(app, { dependencies: { axios: "^1.7.0" }, devDependencies: { axios: "^0.27.0", openai: "^5.0.0" } });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("PackageJsonReader.versionOf", () => {
  it("finds a range in the nearest package.json above the file", () => {
    expect(new PackageJsonReader(root).versionOf(path.join(app, "src", "client.ts"), "openai")).toBe("^5.0.0");
  });

  it("prefers dependencies over devDependencies", () => {
    expect(new PackageJsonReader(root).versionOf(path.join(app, "src", "client.ts"), "axios")).toBe("^1.7.0");
  });

  it("walks up to the root package.json", () => {
    const reader = new PackageJsonReader(root);
    expect(reader.versionOf(path.join(app, "src", "client.ts"), "stripe")).toBe("^14.0.0");
    expect(reader.versionOf(path.join(root, "index.ts"), "vitest")).toBe("^4.0.0");
  });

  it("falls back to the root when the file is too deep to walk up from", () => {
    const deep = path.join(root, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "x.ts");
    expect(new PackageJsonReader(root).versionOf(deep, "stripe")).toBe("^14.0.0");
  });

  it("returns undefined for a package nobody declares", () => {
    expect(new PackageJsonReader(root).versionOf(path.join(app, "src", "client.ts"), "left-pad")).toBeUndefined();
  });
});

describe("PackageJsonReader.read", () => {
  it("reads a missing or invalid package.json as empty", () => {
    const reader = new PackageJsonReader(root);
    writeJson(path.join(root, "bad"), "{ not json");
    writeJson(path.join(root, "null"), "null");
    writeJson(path.join(root, "text"), '"just a string"');
    expect(reader.read(path.join(root, "bad"))).toEqual({});
    expect(reader.read(path.join(root, "null"))).toEqual({});
    expect(reader.read(path.join(root, "text"))).toEqual({});
    expect(reader.read(path.join(root, "nowhere"))).toEqual({});
    expect(reader.versionOf(path.join(root, "bad", "x.ts"), "stripe")).toBe("^14.0.0");
  });

  it("reads each directory once", () => {
    const reader = new PackageJsonReader(root);
    const first = reader.read(app);
    fs.rmSync(path.join(app, "package.json"));
    expect(reader.read(app)).toBe(first);
    expect(reader.versionOf(path.join(app, "src", "client.ts"), "openai")).toBe("^5.0.0");
  });
});
