import { SyntaxKind } from "ts-morph";
import { describe, expect, it } from "vitest";
import { functionValue } from "../../src/detect/fn-value.js";
import { sourceOf } from "../helpers.js";

/** What `functionValue` reads the callee of the last call in `code` as: a function's text, "fetch", or undefined. */
function calleeOf(code: string): string | undefined {
  const calls = sourceOf(code).getDescendantsOfKind(SyntaxKind.CallExpression);
  const v = functionValue(calls[calls.length - 1]!.getExpression());
  return v === "fetch" ? v : v?.fn.getText();
}

describe("functionValue", () => {
  it("reads a member of what a local hook returns, through useCallback", () => {
    const code = `import { useCallback } from "react";
      function useApi() { const send = useCallback((u: string) => fetch(u), []); return { send }; }
      const { send } = useApi(); send("/x");`;
    expect(calleeOf(code)).toBe("(u: string) => fetch(u)");
  });

  it("reads the global fetch kept in a constant or bound", () => {
    expect(calleeOf(`const f = globalThis.fetch; f("/x");`)).toBe("fetch");
    expect(calleeOf(`const f = fetch.bind(globalThis); f("/x");`)).toBe("fetch");
  });

  it("reads none when a factory returns one of two functions", () => {
    const code = `function pick(fast: boolean) { if (fast) return (u: string) => fetch(u); return (u: string) => fetch(u, { cache: "no-store" }); }
      const go = pick(true); go("/x");`;
    expect(calleeOf(code)).toBeUndefined();
  });

  it("reads none for a variable the code may give another function", () => {
    expect(calleeOf(`let send = (u: string) => fetch(u); send = (u: string) => Promise.resolve(u); send("/x");`)).toBeUndefined();
  });

  it("reads none for a hook's member when the hook returns two objects that disagree", () => {
    const code = `function useApi(admin: boolean) { if (admin) return { send: (u: string) => fetch(u) }; return { send: (u: string) => Promise.resolve(u) }; }
      const { send } = useApi(false); send("/x");`;
    expect(calleeOf(code)).toBeUndefined();
  });

  it("does not take a project function named fetch for the global", () => {
    expect(calleeOf(`export function fetch(q: string) { return q; } fetch("SELECT 1");`)).toBe(`export function fetch(q: string) { return q; }`);
  });
});
