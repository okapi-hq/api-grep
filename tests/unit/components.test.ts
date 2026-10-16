import { describe, expect, it } from "vitest";
import { isComponent, parseComponent } from "../../src/lang/html/components.js";

const code = (s: string | undefined): string[] => (s ?? "").split("\n").map((l) => l.trim()).filter((l) => l !== "" && l !== ";");

describe("parseComponent", () => {
  it("keeps the scripts at their positions, the template blank", () => {
    const src = `<template><p @click="load()">{{ x }}</p></template>\n<script setup lang="ts">\nconst x = await fetch("/a");\n</script>`;
    const doc = parseComponent("A.vue", src);
    expect(doc.script).toHaveLength(src.length);
    expect(doc.script!.split("\n")[2]).toBe(`const x = await fetch("/a");`);
    expect(code(doc.script)).toEqual([`const x = await fetch("/a");`]);
  });

  it("reads an Astro frontmatter and its scripts, not a script with src or data", () => {
    const src = `---\nconst r = await fetch("/plans");\n---\n<div>{r}</div>\n<script>go();</script>\n<script src="/x.js"></script>\n<script type="application/ld+json">{"a": 1}</script>`;
    expect(code(parseComponent("P.astro", src).script)).toEqual([`const r = await fetch("/plans");`, "go();;"]);
  });

  it("ends an Astro frontmatter at a --- line outside template literals", () => {
    const src = "---\nconst doc = `\n---\ntitle: x\n---\n`;\nconst r = await fetch(\"/plans\");\n---\n<p>{r}</p>";
    expect(code(parseComponent("D.astro", src).script)).toEqual(["const doc = `", "---", "title: x", "---", "`;", `const r = await fetch("/plans");`]);
  });

  it("has no script when a component holds none, and ignores commented-out scripts", () => {
    expect(parseComponent("B.svelte", `<!-- <script>fetch("/x")</script> -->\n<p>hi</p>`).script).toBeUndefined();
    expect(parseComponent("C.vue", `---\nfetch("/x")\n---\n<template></template>`).script).toBeUndefined();
  });

  it("tells components by their extension", () => {
    expect(isComponent("src/App.vue")).toBe(true);
    expect(isComponent("src/routes/+page.svelte")).toBe(true);
    expect(isComponent("src/pages/index.astro")).toBe(true);
    expect(isComponent("src/app.ts")).toBe(false);
  });
});
