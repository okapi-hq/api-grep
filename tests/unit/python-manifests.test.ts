import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePypi, pythonManifests } from "../../src/lang/python/manifests.js";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "apicalls-py-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

describe("python manifests", () => {
  it("normalizes distribution names (PEP 503)", () => {
    expect(normalizePypi("Sentry_SDK")).toBe("sentry-sdk");
    expect(normalizePypi("zope.interface")).toBe("zope-interface");
  });

  it("reads requirements files, with extras, markers, pins and includes skipped", () => {
    const dir = repo({
      "requirements.txt": "# app\nstripe==9.1.0\nsentry-sdk[flask]~=2.0 ; python_version >= '3.9'\n-r dev.txt\nhttps://example.com/pkg.zip\nRequests\n",
      "requirements/prod.txt": "openai>=1.40\n",
    });
    const m = pythonManifests();
    expect([...m.declared(new Set([dir]), dir)].sort()).toEqual(["openai", "requests", "sentry-sdk", "stripe"]);
    expect(m.version(path.join(dir, "app.py"), "stripe", dir)).toBe("9.1.0");
    expect(m.version(path.join(dir, "app.py"), "sentry_sdk", dir)).toBe("~=2.0");
  });

  it("reads pyproject.toml (PEP 621 and Poetry), Pipfile, setup.cfg and setup.py", () => {
    const pep621 = repo({ "pyproject.toml": '[project]\nname = "x"\ndependencies = ["httpx>=0.27", "anthropic"]\n' });
    const poetry = repo({ "pyproject.toml": '[tool.poetry.dependencies]\npython = "^3.11"\nsupabase = "^2.0"\nboto3 = { version = "1.34" }\n' });
    const pipfile = repo({ Pipfile: '[packages]\ntwilio = "==9.0.0"\nresend = "*"\n' });
    const setup = repo({ "setup.cfg": "[options]\ninstall_requires =\n    posthog>=3\n    slack-sdk\n", "setup.py": 'setup(install_requires=["groq>=0.9"])\n' });
    const m = pythonManifests();
    expect([...m.declared(new Set([pep621]), pep621)].sort()).toEqual(["anthropic", "httpx"]);
    expect([...m.declared(new Set([poetry]), poetry)].sort()).toEqual(["boto3", "supabase"]);
    expect(m.version(path.join(poetry, "a.py"), "boto3", poetry)).toBe("1.34");
    expect([...m.declared(new Set([pipfile]), pipfile)].sort()).toEqual(["resend", "twilio"]);
    expect(m.version(path.join(pipfile, "a.py"), "twilio", pipfile)).toBe("9.0.0");
    expect([...m.declared(new Set([setup]), setup)].sort()).toEqual(["groq", "posthog", "slack-sdk"]);
  });

  it("declares nothing for a manifest that does not parse", () => {
    const dir = repo({ "pyproject.toml": "[project\ndependencies = [" });
    expect(pythonManifests().declared(new Set([dir]), dir).size).toBe(0);
  });

  it("does not read a manifest that links outside the scanned directory", () => {
    const outside = repo({ "requirements.txt": "stripe==9.1.0\n" });
    const dir = repo({});
    symlinkSync(path.join(outside, "requirements.txt"), path.join(dir, "requirements.txt"));
    expect(pythonManifests().declared(new Set([dir]), dir).size).toBe(0);
  });
});
