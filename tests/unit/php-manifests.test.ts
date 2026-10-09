import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { phpManifests } from "../../src/lang/php/manifests.js";

describe("php manifests", () => {
  it("reads require of composer.json, platform packages aside, with versions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "apicalls-php-"));
    writeFileSync(path.join(dir, "composer.json"), JSON.stringify({ require: { php: "^8.2", "ext-curl": "*", "Stripe/Stripe-PHP": "^13.0" }, "require-dev": { "phpunit/phpunit": "^11" } }));
    const m = phpManifests();
    expect([...m.declared(new Set([dir]), dir)]).toEqual(["stripe/stripe-php"]);
    expect(m.version(path.join(dir, "src", "a.php"), "stripe/stripe-php", dir)).toBe("^13.0");
  });

  it("declares nothing for a composer.json that does not parse", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "apicalls-php-"));
    writeFileSync(path.join(dir, "composer.json"), "{ require: ");
    expect(phpManifests().declared(new Set([dir]), dir).size).toBe(0);
  });
});
