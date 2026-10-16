import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePub, parsePubspec, pubManifests } from "../../src/lang/dart/manifests.js";
import { pubspecName } from "../../src/lang/dart/names.js";

const PUBSPEC = `name: harbor_app # the app
description: "An app"
version: 1.0.0+3

environment:
  sdk: ">=3.0.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  http: ^1.2.1
  dio: '5.7.0'
  supabase_flutter:
    version: ^2.8.0
  # a comment
  shared:
    path: ../shared
  dotenv: any

dev_dependencies:
  mockito: ^5.4.0

dependency_overrides:
  http: 1.1.0
`;

describe("pub manifests", () => {
  it("reads dependencies with their versions; dev dependencies and overrides aside", () => {
    expect([...parsePubspec(PUBSPEC)]).toEqual([
      ["flutter", ""],
      ["http", "^1.2.1"],
      ["dio", "5.7.0"],
      ["supabase_flutter", "^2.8.0"],
      ["shared", ""],
      ["dotenv", ""],
    ]);
    expect(parsePubspec("not: [yaml")).toEqual(new Map());
    expect(pubspecName(PUBSPEC)).toBe("harbor_app");
    expect(normalizePub(" Supabase_Flutter ")).toBe("supabase_flutter");
  });

  it("finds the nearest pubspec.yaml above a file for versions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "api-grep-pub-"));
    mkdirSync(path.join(dir, "app", "lib", "api"), { recursive: true });
    writeFileSync(path.join(dir, "app", "pubspec.yaml"), "name: app\ndependencies:\n  dio: ^5.4.0\n");
    const m = pubManifests();
    expect(m.version(path.join(dir, "app", "lib", "api", "client.dart"), "dio", dir)).toBe("^5.4.0");
    expect(m.version(path.join(dir, "app", "lib", "api", "client.dart"), "http", dir)).toBeUndefined();
    expect([...m.declared(new Set([path.join(dir, "app")]), dir)]).toEqual(["dio"]);
  });
});
