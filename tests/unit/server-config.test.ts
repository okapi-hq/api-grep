import { describe, expect, it } from "vitest";
import { isLoopback, limitsFrom, serverConfig } from "../../src/server/config.js";

const TOKEN = "test-token-0123456789";

describe("serverConfig", () => {
  it("listens on loopback without a token by default", () => {
    expect(serverConfig({}, {})).toMatchObject({ host: "127.0.0.1", port: 8080, token: undefined });
  });

  it("requires a token of 16 characters or more beyond loopback", () => {
    expect(() => serverConfig({ host: "0.0.0.0" }, {})).toThrow(/API_GREP_TOKEN/);
    expect(() => serverConfig({ host: "::" }, { API_GREP_TOKEN: "short" })).toThrow(/at least 16/);
    expect(serverConfig({}, { API_GREP_HOST: "::", API_GREP_TOKEN: TOKEN })).toMatchObject({ host: "::", token: TOKEN });
  });

  it("takes the port from the flag, API_GREP_PORT, then PORT", () => {
    expect(serverConfig({ port: 0 }, { PORT: "3000" }).port).toBe(0);
    expect(serverConfig({}, { API_GREP_PORT: "4000", PORT: "3000" }).port).toBe(4000);
    expect(serverConfig({}, { PORT: "3000" }).port).toBe(3000);
    expect(() => serverConfig({}, { PORT: "70000" })).toThrow(/PORT/);
  });
});

describe("limitsFrom", () => {
  it("has defaults and reads whole numbers", () => {
    expect(limitsFrom({})).toMatchObject({ maxEntries: 200_000, scanTimeoutMs: 900_000, heapMb: 8192 });
    expect(limitsFrom({ API_GREP_SCAN_TIMEOUT_S: "60", API_GREP_HEAP_MB: "0" })).toMatchObject({ scanTimeoutMs: 60_000, heapMb: 0 });
    for (const bad of ["-1", "1.5", "lots", "0"]) expect(() => limitsFrom({ API_GREP_MAX_FILES: bad }), bad).toThrow(/API_GREP_MAX_FILES/);
  });
});

describe("isLoopback", () => {
  it("knows the addresses only this machine reaches", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) expect(isLoopback(host), host).toBe(true);
    for (const host of ["0.0.0.0", "::", "10.0.0.2", "example.com", "127.example.com"]) expect(isLoopback(host), host).toBe(false);
  });
});
