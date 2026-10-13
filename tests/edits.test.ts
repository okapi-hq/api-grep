import { describe, expect, it } from "vitest";
import type { Call } from "../src/report/schema.js";
import { at, scanFixture } from "./fixture-helpers.js";

/** Keys added to or removed from a request's arguments after they are built (#38). */
function keys(c: Call): { keys: string[]; required: string[]; dynamicKeys?: boolean } {
  const body = c.body as { type: string; properties: Record<string, unknown>; required: string[]; dynamicKeys?: boolean };
  expect(body.type).toBe("object");
  return { keys: Object.keys(body.properties), required: body.required, ...(body.dynamicKeys ? { dynamicKeys: true } : {}) };
}

describe("edited request arguments: python", () => {
  it("keeps keys set in branches, optional unless every branch sets them", async () => {
    const r = await scanFixture("python/resolve/mutated-kwargs");
    expect(r).toMatchSnapshot();
    expect(keys(at(r, "branches.py", 13))).toEqual({ keys: ["model", "messages", "max_completion_tokens", "max_tokens", "temperature"], required: ["model", "messages"] });
    expect(keys(at(r, "branches.py", 23))).toEqual({ keys: ["messages", "model", "n"], required: ["messages", "model", "n"] });
    expect(at(r, "branches.py", 23).model?.values).toEqual(["gpt-4o-mini", "o3"]);
  });

  it("reads update, setdefault, |=, del and pop", async () => {
    const r = await scanFixture("python/resolve/mutated-kwargs");
    expect(keys(at(r, "forms.py", 11))).toEqual({ keys: ["messages", "model", "max_tokens"], required: ["messages", "model", "max_tokens"] });
    expect(at(r, "forms.py", 11).model?.values).toEqual(["gpt-4o-mini"]);
    expect(keys(at(r, "forms.py", 18)).keys).toEqual(["messages", "model", "seed", "temperature", "top_p"]);
    expect(at(r, "forms.py", 18).model?.values).toEqual(["gpt-4.1"]);
    expect(keys(at(r, "forms.py", 28))).toEqual({ keys: ["model", "messages", "max_tokens", "stream", "user"], required: ["model", "messages", "max_tokens", "stream"] });
    expect(at(r, "forms.py", 28).model?.values).toEqual(["gpt-4.1-mini"]);
    expect(keys(at(r, "forms.py", 37))).toEqual({ keys: ["model", "messages", "temperature"], required: ["model", "messages"] });
    expect(keys(at(r, "forms.py", 42))).toEqual({ keys: ["model"], required: ["model"], dynamicKeys: true });
    expect(keys(at(r, "forms.py", 50))).toEqual({ keys: ["item", "quantity", "priority"], required: ["item", "quantity"] });
    // keys a report record cannot hold are unknown keys
    expect(keys(at(r, "forms.py", 57))).toEqual({ keys: ["model", "messages"], required: ["model", "messages"], dynamicKeys: true });
  });
});

describe("edited request arguments: kotlin", () => {
  it("reads map[\"k\"] = v on a HashMap and a mutableMapOf, optional in a branch unless every branch sets it", async () => {
    const r = await scanFixture("kotlin/maps");
    expect(r).toMatchSnapshot();
    expect(keys(at(r, "Notes.kt", 24))).toEqual({ keys: ["title", "status"], required: ["title"] });
    expect(keys(at(r, "Notes.kt", 35))).toEqual({ keys: ["id", "title", "pinned"], required: ["id", "title", "pinned"] });
    expect(at(r, "Notes.kt", 44)).toMatchObject({ client: "unirest", query: ["q", "tag"], headers: ["x-api-key"] });
  });
});

describe("edited request arguments: php", () => {
  it("reads $params['k'] = v, +=, array_merge and unset", async () => {
    const r = await scanFixture("php/resolve/mutated-params");
    expect(r).toMatchSnapshot();
    expect(keys(at(r, "Assistant.php", 18))).toEqual({ keys: ["model", "messages", "max_completion_tokens", "max_tokens", "temperature"], required: ["model", "messages"] });
    expect(keys(at(r, "Assistant.php", 31))).toEqual({ keys: ["messages", "model", "max_tokens", "user"], required: ["messages", "model", "max_tokens"] });
    expect(at(r, "Assistant.php", 31).model?.values).toEqual(["gpt-4.1"]);
    expect(keys(at(r, "Assistant.php", 39))).toEqual({ keys: ["item", "quantity"], required: ["item", "quantity"] });
  });
});

describe("edited request arguments: typescript and javascript", () => {
  it("reads property assignments, Object.assign and delete before the call", async () => {
    const r = await scanFixture("resolve/mutated-params");
    expect(r).toMatchSnapshot();
    expect(keys(at(r, "params.ts", 9))).toEqual({ keys: ["model", "messages", "max_completion_tokens", "max_tokens"], required: ["model", "messages"] });
    expect(keys(at(r, "params.ts", 19))).toEqual({ keys: ["messages", "model"], required: ["messages", "model"] });
    expect(at(r, "params.ts", 19).model?.values).toEqual(["gpt-4o-mini", "o3"]);
    expect(keys(at(r, "params.ts", 27))).toEqual({ keys: ["messages", "seed", "model", "user"], required: ["messages", "seed", "model"] });
    expect(at(r, "params.ts", 27).model?.values).toEqual(["gpt-4.1"]);
    // edits after the call or in a nested function are not part of this request
    expect(keys(at(r, "params.ts", 32))).toEqual({ keys: ["model", "messages"], required: ["model", "messages"] });
    expect(keys(at(r, "params.ts", 45))).toEqual({ keys: ["model", "messages"], required: ["model", "messages"], dynamicKeys: true });
    expect(keys(at(r, "order.js", 5))).toEqual({ keys: ["item", "quantity", "priority"], required: ["item", "quantity"] });
  });
});
